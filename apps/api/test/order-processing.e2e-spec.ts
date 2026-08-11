import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { AppEnv } from '../src/config/env.schema';
import {
  ERP_PROCESSOR_PORT,
  type ErpProcessingResult,
  type ErpProcessorPort,
} from '../src/erp/erp-processor.port';
import {
  ErpSimulatorAdapter,
  InvalidSimulationScriptError,
  SimulationScriptExhaustedError,
  type SimulationMode,
} from '../src/erp/erp-simulator.adapter';
import { InventoryService } from '../src/inventory/inventory.service';
import { OrdersRepository } from '../src/orders/orders.repository';
import { ORDER_FAILURE_CODE, OrderStatus } from '../src/orders/order-status';
import { OrderProcessingWorker } from '../src/worker/order-processing.worker';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createSimulator(
  mode: SimulationMode,
  script = 'failure,success',
): ErpSimulatorAdapter {
  const config: AppEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost/app',
    DATABASE_URL_TEST: 'postgresql://user:pass@localhost/app_test',
    WORKER_POLL_MS: 100,
    ERP_SIMULATION_DELAY_MS: 0,
    ERP_SIMULATION_MODE: mode,
    ERP_SIMULATION_SCRIPT: script,
  };
  return new ErpSimulatorAdapter(new ConfigService<AppEnv, true>(config));
}

const ERP_INPUT = {
  operationId: '22222222-2222-4222-8222-222222222222',
  productId: PRODUCT_ID,
  quantity: 1,
};

describe('ERP simulator', () => {
  it.each([
    ['success', { ok: true }],
    ['failure', { ok: false, code: ORDER_FAILURE_CODE }],
  ] as const)(
    'remains ready in deterministic %s mode',
    async (mode, expected) => {
      const simulator = createSimulator(mode);

      expect(() => simulator.assertReady()).not.toThrow();
      await expect(simulator.process(ERP_INPUT)).resolves.toEqual(expected);
      expect(() => simulator.assertReady()).not.toThrow();
    },
  );

  it('consumes failure,success in order and fails after the final token', async () => {
    const simulator = createSimulator('scripted', 'failure,success');
    expect(() => simulator.assertReady()).not.toThrow();

    await expect(simulator.process(ERP_INPUT)).resolves.toEqual({
      ok: false,
      code: ORDER_FAILURE_CODE,
    });
    expect(() => simulator.assertReady()).not.toThrow();
    await expect(simulator.process(ERP_INPUT)).resolves.toEqual({ ok: true });
    expect(() => simulator.assertReady()).toThrow(
      SimulationScriptExhaustedError,
    );
    await expect(simulator.process(ERP_INPUT)).rejects.toBeInstanceOf(
      SimulationScriptExhaustedError,
    );
  });

  it.each(['', 'success,unknown', 'failure,'])(
    'rejects malformed scripted sequence %p',
    (script) => {
      expect(() => createSimulator('scripted', script)).toThrow(
        InvalidSimulationScriptError,
      );
    },
  );
});

describe('order processing worker', () => {
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let worker: OrderProcessingWorker;
  let orders: OrdersRepository;
  const assertReady = jest.fn((): void => undefined);
  const processor: jest.Mocked<ErpProcessorPort> = {
    assertReady,
    process: jest.fn(),
  };

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);

    moduleRef = await Test.createTestingModule({
      providers: [
        OrdersRepository,
        InventoryService,
        OrderProcessingWorker,
        { provide: DataSource, useValue: dataSource },
        { provide: ERP_PROCESSOR_PORT, useValue: processor },
      ],
    }).compile();
    worker = moduleRef.get(OrderProcessingWorker);
    orders = moduleRef.get(OrdersRepository);
  });

  beforeEach(async () => {
    assertReady.mockReset();
    processor.process.mockReset();
    await resetTestDatabase(dataSource);
    await seedTestDatabase(dataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function insertReservedOrder(
    quantity = 2,
    createdAt = new Date(),
  ): Promise<string> {
    const orderId = randomUUID();
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE products
         SET stock_reserved = stock_reserved + $2
         WHERE id = $1`,
        [PRODUCT_ID, quantity],
      );
      await manager.query(
        `INSERT INTO orders (
           id, product_id, quantity, status, failure_code,
           processing_started_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, NULL, NULL, $5, $5)`,
        [orderId, PRODUCT_ID, quantity, OrderStatus.Pending, createdAt],
      );
    });
    return orderId;
  }

  async function readState(orderId: string) {
    const [ordersState, products] = await Promise.all([
      dataSource.query<
        Array<{ status: OrderStatus; failure_code: string | null }>
      >(
        `SELECT status, failure_code
         FROM orders
         WHERE id = $1`,
        [orderId],
      ),
      dataSource.query<
        Array<{ stock_on_hand: number; stock_reserved: number }>
      >(
        `SELECT stock_on_hand, stock_reserved
         FROM products
         WHERE id = $1`,
        [PRODUCT_ID],
      ),
    ]);
    return { order: ordersState[0], product: products[0] };
  }

  it('completes a sale once and guards a second local finalization', async () => {
    const orderId = await insertReservedOrder();
    const before = await readState(orderId);
    expect(before.product.stock_reserved).toBe(2);
    processor.process.mockResolvedValue({ ok: true });

    await worker.poll();

    const after = await readState(orderId);
    expect(after.order).toEqual({
      status: OrderStatus.Completed,
      failure_code: null,
    });
    expect(after.product.stock_on_hand).toBe(before.product.stock_on_hand - 2);
    expect(after.product.stock_reserved).toBe(
      before.product.stock_reserved - 2,
    );
    const secondFinalization = await dataSource.transaction((manager) =>
      orders.finalizeProcessing(manager, orderId, OrderStatus.Completed, null),
    );
    expect(secondFinalization).toBeNull();
    expect(await readState(orderId)).toEqual(after);
  });

  it('fails terminally and releases only reserved stock', async () => {
    const orderId = await insertReservedOrder();
    const before = await readState(orderId);
    expect(before.product.stock_reserved).toBe(2);
    processor.process.mockResolvedValue({
      ok: false,
      code: ORDER_FAILURE_CODE,
    });

    await worker.poll();

    const after = await readState(orderId);
    expect(after.order).toEqual({
      status: OrderStatus.Failed,
      failure_code: ORDER_FAILURE_CODE,
    });
    expect(after.product.stock_on_hand).toBe(before.product.stock_on_hand);
    expect(after.product.stock_reserved).toBe(
      before.product.stock_reserved - 2,
    );
  });

  it('applies a fresh scripted simulator to claims in deterministic order', async () => {
    const firstId = await insertReservedOrder(
      1,
      new Date('2026-01-01T00:00:00Z'),
    );
    const secondId = await insertReservedOrder(
      1,
      new Date('2026-01-01T00:00:01Z'),
    );
    const before = await readState(secondId);
    expect(before.product.stock_reserved).toBe(2);
    const simulator = createSimulator('scripted', 'failure,success');
    processor.process.mockImplementation((input) => simulator.process(input));

    await worker.poll();
    await worker.poll();

    expect((await readState(firstId)).order).toEqual({
      status: OrderStatus.Failed,
      failure_code: ORDER_FAILURE_CODE,
    });
    const after = await readState(secondId);
    expect(after.order).toEqual({
      status: OrderStatus.Completed,
      failure_code: null,
    });
    expect(after.product.stock_on_hand).toBe(before.product.stock_on_hand - 1);
    expect(after.product.stock_reserved).toBe(
      before.product.stock_reserved - 2,
    );
  });

  it('leaves the next order pending when the simulator script is exhausted', async () => {
    await insertReservedOrder(1, new Date('2026-01-01T00:00:00Z'));
    const nextOrderId = await insertReservedOrder(
      1,
      new Date('2026-01-01T00:00:01Z'),
    );
    const simulator = createSimulator('scripted', 'success');
    assertReady.mockImplementation(() => simulator.assertReady());
    processor.process.mockImplementation((input) => simulator.process(input));

    await worker.poll();
    const beforeExhaustedPoll = await readState(nextOrderId);
    expect(beforeExhaustedPoll.order).toEqual({
      status: OrderStatus.Pending,
      failure_code: null,
    });
    expect(beforeExhaustedPoll.product.stock_reserved).toBe(1);

    await expect(worker.poll()).rejects.toBeInstanceOf(
      SimulationScriptExhaustedError,
    );

    expect(processor.process.mock.calls).toHaveLength(1);
    expect(await readState(nextOrderId)).toEqual(beforeExhaustedPoll);
  });

  it('uses its in-memory guard to process only one order at a time', async () => {
    await insertReservedOrder(1, new Date('2026-01-01T00:00:00Z'));
    await insertReservedOrder(1, new Date('2026-01-01T00:00:01Z'));
    const started = deferred<void>();
    const blocked = deferred<ErpProcessingResult>();
    processor.process.mockImplementation(() => {
      started.resolve(undefined);
      return blocked.promise;
    });

    const firstPoll = worker.poll();
    await started.promise;
    await worker.poll();

    expect(processor.process.mock.calls).toHaveLength(1);
    blocked.resolve({ ok: true });
    await firstPoll;

    const statuses = await dataSource.query<
      Array<{ status: OrderStatus; count: number }>
    >(
      `SELECT status, count(*)::integer AS count
       FROM orders
       GROUP BY status
       ORDER BY status`,
    );
    expect(statuses).toEqual([
      { status: OrderStatus.Completed, count: 1 },
      { status: OrderStatus.Pending, count: 1 },
    ]);
  });
});

describe('non-blocking checkout', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;
  let started: Deferred<void>;
  let blocked: Deferred<ErpProcessingResult>;
  const processor: jest.Mocked<ErpProcessorPort> = {
    process: jest.fn(),
  };

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(ERP_PROCESSOR_PORT)
      .useValue(processor)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await resetTestDatabase(dataSource);
    await seedTestDatabase(dataSource);
    started = deferred<void>();
    blocked = deferred<ErpProcessingResult>();
    processor.process.mockReset();
    processor.process.mockImplementation(() => {
      started.resolve(undefined);
      return blocked.promise;
    });
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function waitForOrderStatus(
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    for (;;) {
      const rows = await dataSource.query<Array<{ status: OrderStatus }>>(
        'SELECT status FROM orders WHERE id = $1',
        [orderId],
      );
      if (rows[0]?.status === status) {
        return;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  it('returns 202 before the blocked simulator is resolved', async () => {
    let simulatorResolved = false;
    void blocked.promise.then(() => {
      simulatorResolved = true;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': randomUUID() },
      payload: { productId: PRODUCT_ID, quantity: 1 },
    });
    await started.promise;

    expect(response.statusCode).toBe(202);
    expect(simulatorResolved).toBe(false);
    const orderId = response.json<{ order: { id: string } }>().order.id;
    expect(processor.process.mock.calls).toContainEqual([
      {
        operationId: orderId,
        productId: PRODUCT_ID,
        quantity: 1,
      },
    ]);

    blocked.resolve({ ok: true });
    await waitForOrderStatus(orderId, OrderStatus.Completed);
  });
});
