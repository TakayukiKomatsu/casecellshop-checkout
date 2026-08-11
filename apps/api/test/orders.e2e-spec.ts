import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HttpErrorFilter } from '../src/observability/http-error.filter';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersRepository } from '../src/orders/orders.repository';
import {
  ORDER_FAILURE_CODE,
  OrderStatus,
  type OrderFailureCode,
} from '../src/orders/order-status';
import { OrdersService } from '../src/orders/orders.service';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ErrorBody = {
  code: string;
  message: string;
  correlationId: string;
};

type OrderBody = {
  id: string;
  productId: string;
  quantity: number;
  status: OrderStatus;
  failureCode: OrderFailureCode | null;
  createdAt: string;
  updatedAt: string;
};

describe('GET /api/orders/:id', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        OrdersRepository,
        OrdersService,
        { provide: DataSource, useValue: dataSource },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            forbidNonWhitelisted: true,
            transform: true,
            whitelist: true,
          }),
        },
      ],
    }).compile();

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
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it.each<{
    status: OrderStatus;
    failureCode: OrderFailureCode | null;
  }>([
    { status: OrderStatus.Pending, failureCode: null },
    { status: OrderStatus.Processing, failureCode: null },
    { status: OrderStatus.Completed, failureCode: null },
    { status: OrderStatus.Failed, failureCode: ORDER_FAILURE_CODE },
  ])('returns $status and its failureCode', async ({ status, failureCode }) => {
    const orderId = randomUUID();
    await dataSource.query(
      `INSERT INTO orders (
         id, product_id, quantity, status, failure_code,
         processing_started_at, created_at, updated_at
       )
       VALUES ($1, $2, 2, $3, $4, NULL, now(), now())`,
      [orderId, PRODUCT_ID, status, failureCode],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<OrderBody>();
    expect(body).toEqual({
      id: orderId,
      productId: PRODUCT_ID,
      quantity: 2,
      status,
      failureCode,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
    });
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('returns exact ORDER_NOT_FOUND envelope for an unknown UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/orders/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ErrorBody>();
    expect(body).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'Pedido não encontrado.',
      correlationId: body.correlationId,
    });
    expect(body.correlationId).toMatch(UUID_PATTERN);
  });

  it('returns exact VALIDATION_ERROR envelope for a malformed UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody>();
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Dados da solicitação inválidos.',
      correlationId: body.correlationId,
    });
    expect(body.correlationId).toMatch(UUID_PATTERN);
  });
});
