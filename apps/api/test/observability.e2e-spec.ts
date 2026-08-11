import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  ERP_PROCESSOR_PORT,
  type ErpProcessorPort,
} from '../src/erp/erp-processor.port';
import {
  createApiFastifyAdapter,
  registerRequestCompletionLogging,
} from '../src/observability/fastify-observability';
import { ORDER_FAILURE_CODE, OrderStatus } from '../src/orders/order-status';
import { OrderProcessingWorker } from '../src/worker/order-processing.worker';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LogRecord = Record<string, unknown> & {
  event?: string;
};

type OrderResponse = {
  replayed: boolean;
  order: { id: string };
};

describe('structured observability', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;
  let worker: OrderProcessingWorker;
  let chunks: string[];
  const processor: jest.Mocked<ErpProcessorPort> = {
    process: jest.fn(),
  };

  beforeAll(async () => {
    chunks = [];
    const stream = new Writable({
      write(chunk: unknown, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
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
      createApiFastifyAdapter(stream),
      { logger: false },
    );
    app.setGlobalPrefix('api');
    registerRequestCompletionLogging(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    worker = app.get(OrderProcessingWorker);

    const scheduler = app.get(SchedulerRegistry);
    for (const name of scheduler.getIntervals()) {
      scheduler.deleteInterval(name);
    }
  });

  beforeEach(async () => {
    chunks.length = 0;
    processor.process.mockReset();
    await resetTestDatabase(dataSource);
    await seedTestDatabase(dataSource);
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  function postOrder(idempotencyKey: string) {
    return app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': idempotencyKey },
      payload: { productId: PRODUCT_ID, quantity: 1 },
    });
  }

  function readLogs(): LogRecord[] {
    return chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogRecord);
  }

  function expectLogMetadata(record: LogRecord): void {
    expect(typeof record.correlationId).toBe('string');
    expect(record.correlationId).toEqual(expect.stringMatching(UUID_PATTERN));
    expect(typeof record.durationMs).toBe('number');
  }

  it('correlates create, replay, successful, and failed lifecycle events without sensitive data', async () => {
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    processor.process
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, code: ORDER_FAILURE_CODE });

    const firstCreate = await postOrder(firstKey);
    const first = firstCreate.json<OrderResponse>();
    const replay = await postOrder(firstKey);
    const replayed = replay.json<OrderResponse>();
    await worker.poll();
    const secondCreate = await postOrder(secondKey);
    const second = secondCreate.json<OrderResponse>();
    await worker.poll();

    expect(firstCreate.statusCode).toBe(202);
    expect(replay.statusCode).toBe(200);
    expect(replayed).toEqual({ ...first, replayed: true });
    expect(secondCreate.statusCode).toBe(202);

    const logs = readLogs();
    const events = (event: string) =>
      logs.filter((record) => record.event === event);
    const created = events('order.created');
    const replayEvents = events('order.idempotency_replayed');
    const started = events('order.processing_started');
    const completed = events('order.completed');
    const failed = events('order.failed');
    const requests = events('http.request.completed');

    expect(created).toHaveLength(2);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          newStatus: OrderStatus.Pending,
          orderId: first.order.id,
          previousStatus: null,
        }),
        expect.objectContaining({
          newStatus: OrderStatus.Pending,
          orderId: second.order.id,
          previousStatus: null,
        }),
      ]),
    );
    for (const event of created) {
      expectLogMetadata(event);
    }
    expect(replayEvents).toEqual([
      expect.objectContaining({
        orderId: first.order.id,
        status: OrderStatus.Pending,
      }),
    ]);
    for (const event of replayEvents) {
      expectLogMetadata(event);
    }
    expect(started).toHaveLength(2);
    for (const event of started) {
      expectLogMetadata(event);
      expect(event).toEqual(
        expect.objectContaining({
          newStatus: OrderStatus.Processing,
          previousStatus: OrderStatus.Pending,
        }),
      );
    }
    expect(completed).toEqual([
      expect.objectContaining({
        correlationId: started.find((event) => event.orderId === first.order.id)
          ?.correlationId,
        newStatus: OrderStatus.Completed,
        orderId: first.order.id,
        previousStatus: OrderStatus.Processing,
      }),
    ]);
    for (const event of completed) {
      expectLogMetadata(event);
    }
    expect(failed).toEqual([
      expect.objectContaining({
        correlationId: started.find(
          (event) => event.orderId === second.order.id,
        )?.correlationId,
        failureCode: ORDER_FAILURE_CODE,
        newStatus: OrderStatus.Failed,
        orderId: second.order.id,
        previousStatus: OrderStatus.Processing,
      }),
    ]);
    for (const event of failed) {
      expectLogMetadata(event);
    }
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expectLogMetadata(request);
      expect(typeof request.statusCode).toBe('number');
      expect(request).toEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/orders',
        }),
      );
    }

    const serialized = chunks.join('');
    expect(serialized).not.toContain(firstKey);
    expect(serialized).not.toContain(secondKey);
    expect(serialized).not.toContain(PRODUCT_ID);
    expect(serialized).not.toContain('idempotency-key');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toMatch(/"(?:body|payload|quantity)"/);
  });
});
