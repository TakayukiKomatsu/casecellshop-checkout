import { createHash, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CHECKOUT_PRE_COMMIT_HOOK } from '../src/checkout/checkout.service';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DatabaseState = {
  products: unknown[];
  orders: unknown[];
  idempotencyRecords: unknown[];
};

type CheckoutBody = {
  productId?: unknown;
  quantity?: unknown;
  extra?: unknown;
};

type ErrorBody = {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
};
type HttpResponse = {
  statusCode: number;
  json<T = unknown>(): T;
};

describe('POST /api/orders', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;
  const beforeCommit = jest.fn(() => Promise.resolve());

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(CHECKOUT_PRE_COMMIT_HOOK)
      .useValue(beforeCommit)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const scheduler = app.get(SchedulerRegistry);
    for (const name of scheduler.getIntervals()) {
      scheduler.deleteInterval(name);
    }
  });

  beforeEach(async () => {
    beforeCommit.mockReset();
    beforeCommit.mockResolvedValue(undefined);
    await resetTestDatabase(dataSource);
    await seedTestDatabase(dataSource);
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function readDatabaseState(): Promise<DatabaseState> {
    const [products, orders, idempotencyRecords] = await Promise.all([
      dataSource.query<unknown[]>(
        `SELECT id, stock_on_hand, stock_reserved
         FROM products
         ORDER BY id`,
      ),
      dataSource.query<unknown[]>(
        `SELECT id, product_id, quantity, status, failure_code
         FROM orders
         ORDER BY id`,
      ),
      dataSource.query<unknown[]>(
        `SELECT key, request_fingerprint, order_id
         FROM idempotency_records
         ORDER BY key`,
      ),
    ]);

    return { products, orders, idempotencyRecords };
  }

  function postOrder(key: string | undefined, body: CheckoutBody) {
    return app.inject({
      method: 'POST',
      url: '/api/orders',
      ...(key ? { headers: { 'idempotency-key': key } } : {}),
      payload: body,
    });
  }

  function expectError(
    response: HttpResponse,
    statusCode: number,
    code: string,
    message: string,
  ): ErrorBody {
    expect(response.statusCode).toBe(statusCode);
    const body = response.json<ErrorBody>();
    expect(body).toEqual({
      code,
      message,
      correlationId: body.correlationId,
      ...(body.details ? { details: body.details } : {}),
    });
    expect(body.correlationId).toMatch(UUID_PATTERN);
    return body;
  }

  it('creates one pending order, reserves stock, and persists the exact fingerprint atomically', async () => {
    const idempotencyKey = randomUUID();

    const response = await postOrder(idempotencyKey, {
      productId: PRODUCT_ID,
      quantity: 2,
    });

    expect(response.statusCode).toBe(202);
    const body = response.json<{
      replayed: boolean;
      order: {
        id: string;
        productId: string;
        quantity: number;
        status: string;
        failureCode: null;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    expect(body).toEqual({
      replayed: false,
      order: {
        id: body.order.id,
        productId: PRODUCT_ID,
        quantity: 2,
        status: 'PENDING',
        failureCode: null,
        createdAt: body.order.createdAt,
        updatedAt: body.order.updatedAt,
      },
    });
    expect(body.order.id).toMatch(UUID_PATTERN);
    expect(typeof body.order.createdAt).toBe('string');
    expect(typeof body.order.updatedAt).toBe('string');
    expect(new Date(body.order.createdAt).toISOString()).toBe(
      body.order.createdAt,
    );
    expect(new Date(body.order.updatedAt).toISOString()).toBe(
      body.order.updatedAt,
    );
    expect(response.headers.location).toBe(`/api/orders/${body.order.id}`);

    const [productRows, orderRows, idempotencyRows] = await Promise.all([
      dataSource.query<
        Array<{ stock_on_hand: number; stock_reserved: number }>
      >(
        `SELECT stock_on_hand, stock_reserved
         FROM products
         WHERE id = $1`,
        [PRODUCT_ID],
      ),
      dataSource.query<
        Array<{
          id: string;
          product_id: string;
          quantity: number;
          status: string;
          failure_code: string | null;
        }>
      >(
        `SELECT id, product_id, quantity, status, failure_code
         FROM orders`,
      ),
      dataSource.query<
        Array<{
          key: string;
          request_fingerprint: string;
          order_id: string;
        }>
      >(
        `SELECT key, request_fingerprint, order_id
         FROM idempotency_records`,
      ),
    ]);
    expect(productRows).toEqual([{ stock_on_hand: 8, stock_reserved: 2 }]);
    expect(orderRows).toEqual([
      {
        id: body.order.id,
        product_id: PRODUCT_ID,
        quantity: 2,
        status: 'PENDING',
        failure_code: null,
      },
    ]);
    expect(idempotencyRows).toEqual([
      {
        key: idempotencyKey,
        request_fingerprint: createHash('sha256')
          .update(JSON.stringify([PRODUCT_ID, 2]))
          .digest('hex'),
        order_id: body.order.id,
      },
    ]);
    expect(beforeCommit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['zero quantity', { productId: PRODUCT_ID, quantity: 0 }],
    ['negative quantity', { productId: PRODUCT_ID, quantity: -1 }],
    ['fractional quantity', { productId: PRODUCT_ID, quantity: 1.5 }],
    ['string quantity', { productId: PRODUCT_ID, quantity: '1' }],
    [
      'unsafe integer quantity',
      { productId: PRODUCT_ID, quantity: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ['missing quantity', { productId: PRODUCT_ID }],
    ['missing product', { quantity: 1 }],
    ['malformed product UUID', { productId: 'not-a-uuid', quantity: 1 }],
    [
      'unexpected body field',
      { productId: PRODUCT_ID, quantity: 1, extra: true },
    ],
  ])('rejects %s before mutating any table', async (_case, payload) => {
    const before = await readDatabaseState();

    const response = await postOrder(randomUUID(), payload);

    expectError(
      response,
      400,
      'VALIDATION_ERROR',
      'Dados da solicitação inválidos.',
    );
    expect(await readDatabaseState()).toEqual(before);
  });

  it.each([
    ['a missing idempotency key', undefined],
    ['a malformed idempotency key', 'not-a-uuid'],
  ])('rejects %s before mutating any table', async (_case, key) => {
    const before = await readDatabaseState();

    const response = await postOrder(key, {
      productId: PRODUCT_ID,
      quantity: 1,
    });

    expectError(
      response,
      400,
      'VALIDATION_ERROR',
      'Dados da solicitação inválidos.',
    );
    expect(await readDatabaseState()).toEqual(before);
  });

  it('returns PRODUCT_NOT_FOUND and rolls back the idempotency claim', async () => {
    const before = await readDatabaseState();

    const response = await postOrder(randomUUID(), {
      productId: randomUUID(),
      quantity: 1,
    });

    expectError(response, 404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    expect(await readDatabaseState()).toEqual(before);
  });

  it('returns current availability and rolls back every write when stock is insufficient', async () => {
    await dataSource.query(
      `UPDATE products
       SET stock_on_hand = 1, stock_reserved = 0
       WHERE id = $1`,
      [PRODUCT_ID],
    );
    const before = await readDatabaseState();

    const response = await postOrder(randomUUID(), {
      productId: PRODUCT_ID,
      quantity: 2,
    });

    const body = expectError(
      response,
      409,
      'INSUFFICIENT_STOCK',
      'Estoque insuficiente para a quantidade solicitada.',
    );
    expect(body.details).toEqual({ availableStock: 1 });
    expect(await readDatabaseState()).toEqual(before);
  });

  it('replays the original order without reserving stock again', async () => {
    const idempotencyKey = randomUUID();
    const payload = { productId: PRODUCT_ID, quantity: 2 };
    const created = await postOrder(idempotencyKey, payload);
    const stateAfterCreation = await readDatabaseState();

    const replay = await postOrder(idempotencyKey, payload);

    expect(created.statusCode).toBe(202);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({
      ...created.json(),
      replayed: true,
    });
    expect(replay.headers.location).toBe(
      `/api/orders/${created.json<{ order: { id: string } }>().order.id}`,
    );
    expect(await readDatabaseState()).toEqual(stateAfterCreation);
    expect(beforeCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed payload for the same key without mutation', async () => {
    const idempotencyKey = randomUUID();
    const created = await postOrder(idempotencyKey, {
      productId: PRODUCT_ID,
      quantity: 1,
    });
    expect(created.statusCode).toBe(202);
    const beforeConflict = await readDatabaseState();

    const conflict = await postOrder(idempotencyKey, {
      productId: PRODUCT_ID,
      quantity: 2,
    });

    expectError(
      conflict,
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Chave de idempotência já utilizada com dados diferentes.',
    );
    expect(await readDatabaseState()).toEqual(beforeConflict);
  });

  it('maps an injected pre-commit failure to INTERNAL_ERROR and rolls back all writes', async () => {
    beforeCommit.mockRejectedValueOnce(new Error('secret injected failure'));
    const before = await readDatabaseState();

    const response = await postOrder(randomUUID(), {
      productId: PRODUCT_ID,
      quantity: 2,
    });

    expectError(response, 500, 'INTERNAL_ERROR', 'Erro interno do servidor.');
    expect(response.body).not.toContain('secret injected failure');
    expect(await readDatabaseState()).toEqual(before);
  });
});
