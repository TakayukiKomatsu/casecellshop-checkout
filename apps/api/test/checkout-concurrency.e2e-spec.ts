import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

type OrderResponse = {
  replayed: boolean;
  order: { id: string };
};
type ErrorResponse = {
  code: string;
  message: string;
  correlationId: string;
  details: { availableStock: number };
};

type CountRow = { count: number };

type InventoryRow = {
  stock_on_hand: number;
  stock_reserved: number;
};

describe('POST /api/orders PostgreSQL concurrency', () => {
  let firstApp: NestFastifyApplication;
  let secondApp: NestFastifyApplication;
  let firstDataSource: DataSource;
  let secondDataSource: DataSource;
  let verificationDataSource: DataSource;

  async function createApp(dataSource: DataSource) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const scheduler = app.get(SchedulerRegistry);
    for (const name of scheduler.getIntervals()) {
      scheduler.deleteInterval(name);
    }
    return app;
  }

  beforeAll(async () => {
    verificationDataSource = createTestDataSource();
    await verificationDataSource.initialize();
    await recreateTestSchema(verificationDataSource);

    firstDataSource = createTestDataSource();
    secondDataSource = createTestDataSource();
    await Promise.all([
      firstDataSource.initialize(),
      secondDataSource.initialize(),
    ]);
    [firstApp, secondApp] = await Promise.all([
      createApp(firstDataSource),
      createApp(secondDataSource),
    ]);
  });

  beforeEach(async () => {
    await resetTestDatabase(verificationDataSource);
    await seedTestDatabase(verificationDataSource);
    await verificationDataSource.query(
      `UPDATE products
       SET stock_on_hand = 1, stock_reserved = 0
       WHERE id = $1`,
      [PRODUCT_ID],
    );
  });

  afterAll(async () => {
    await Promise.all([firstApp?.close(), secondApp?.close()]);
    await Promise.all(
      [firstDataSource, secondDataSource, verificationDataSource]
        .filter((dataSource) => dataSource?.isInitialized)
        .map((dataSource) => dataSource.destroy()),
    );
  });

  function postOrder(app: NestFastifyApplication, key: string, quantity = 1) {
    return app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': key },
      payload: { productId: PRODUCT_ID, quantity },
    });
  }

  it('allows exactly one of two different keys to reserve the last unit', async () => {
    const settled = await Promise.allSettled([
      postOrder(firstApp, randomUUID()),
      postOrder(secondApp, randomUUID()),
    ]);
    const responses = settled.map((result) => {
      if (result.status === 'rejected') {
        throw result.reason;
      }
      return result.value;
    });

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      202, 409,
    ]);
    const conflict = responses
      .find((response) => response.statusCode === 409)
      ?.json<ErrorResponse>();
    expect(conflict).toEqual({
      code: 'INSUFFICIENT_STOCK',
      message: 'Estoque insuficiente para a quantidade solicitada.',
      correlationId: conflict?.correlationId,
      details: { availableStock: 0 },
    });
    expect(typeof conflict?.correlationId).toBe('string');

    const [orderCount, idempotencyCount, inventory] = await Promise.all([
      verificationDataSource.query<CountRow[]>(
        'SELECT count(*)::int AS count FROM orders',
      ),
      verificationDataSource.query<CountRow[]>(
        'SELECT count(*)::int AS count FROM idempotency_records',
      ),
      verificationDataSource.query<InventoryRow[]>(
        `SELECT stock_on_hand, stock_reserved
         FROM products
         WHERE id = $1`,
        [PRODUCT_ID],
      ),
    ]);
    expect(orderCount).toEqual([{ count: 1 }]);
    expect(idempotencyCount).toEqual([{ count: 1 }]);
    expect(inventory).toEqual([{ stock_on_hand: 1, stock_reserved: 1 }]);
  });

  it('resolves a same-key race before inventory and returns one creation plus one replay', async () => {
    const idempotencyKey = randomUUID();
    const settled = await Promise.allSettled([
      postOrder(firstApp, idempotencyKey),
      postOrder(secondApp, idempotencyKey),
    ]);
    const responses = settled.map((result) => {
      if (result.status === 'rejected') {
        throw result.reason;
      }
      return result.value;
    });

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 202,
    ]);
    const bodies = responses.map((response) => response.json<OrderResponse>());
    expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(bodies[0].order.id).toBe(bodies[1].order.id);

    const [orderCount, idempotencyRows, inventory] = await Promise.all([
      verificationDataSource.query<CountRow[]>(
        'SELECT count(*)::int AS count FROM orders',
      ),
      verificationDataSource.query<
        Array<CountRow & { distinct_orders: number }>
      >(
        `SELECT count(*)::int AS count,
                count(DISTINCT order_id)::int AS distinct_orders
         FROM idempotency_records`,
      ),
      verificationDataSource.query<InventoryRow[]>(
        `SELECT stock_on_hand, stock_reserved
         FROM products
         WHERE id = $1`,
        [PRODUCT_ID],
      ),
    ]);
    expect(orderCount).toEqual([{ count: 1 }]);
    expect(idempotencyRows).toEqual([{ count: 1, distinct_orders: 1 }]);
    expect(inventory).toEqual([{ stock_on_hand: 1, stock_reserved: 1 }]);
  });
});
