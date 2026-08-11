import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ORDER_FAILURE_CODE,
  OrderStatus,
  type OrderFailureCode,
} from '../orders/order-status';

export type OrderEvent =
  | 'order.created'
  | 'order.idempotency_replayed'
  | 'order.processing_started'
  | 'order.completed'
  | 'order.failed';

export interface JsonEventLogger {
  info(fields: Record<string, unknown>, message?: string): void;
}

type FastifyInstance = {
  log: JsonEventLogger;
};

@Injectable()
export class OrderEvents {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  created(
    logger: JsonEventLogger,
    correlationId: string,
    orderId: string,
    durationMs: number,
  ): void {
    this.write(logger, {
      event: 'order.created',
      correlationId,
      orderId,
      previousStatus: null,
      newStatus: OrderStatus.Pending,
      durationMs,
    });
  }

  replayed(
    logger: JsonEventLogger,
    correlationId: string,
    orderId: string,
    status: OrderStatus,
    durationMs: number,
  ): void {
    this.write(logger, {
      event: 'order.idempotency_replayed',
      correlationId,
      orderId,
      status,
      durationMs,
    });
  }

  processingStarted(
    correlationId: string,
    orderId: string,
    durationMs: number,
  ): void {
    this.write(this.rootLogger(), {
      event: 'order.processing_started',
      correlationId,
      orderId,
      previousStatus: OrderStatus.Pending,
      newStatus: OrderStatus.Processing,
      durationMs,
    });
  }

  completed(correlationId: string, orderId: string, durationMs: number): void {
    this.write(this.rootLogger(), {
      event: 'order.completed',
      correlationId,
      orderId,
      previousStatus: OrderStatus.Processing,
      newStatus: OrderStatus.Completed,
      durationMs,
    });
  }

  failed(
    correlationId: string,
    orderId: string,
    durationMs: number,
    failureCode: OrderFailureCode = ORDER_FAILURE_CODE,
  ): void {
    this.write(this.rootLogger(), {
      event: 'order.failed',
      correlationId,
      orderId,
      previousStatus: OrderStatus.Processing,
      newStatus: OrderStatus.Failed,
      durationMs,
      failureCode,
    });
  }

  private rootLogger(): JsonEventLogger {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) {
      throw new Error('HTTP adapter is not available for lifecycle logging');
    }

    return adapter.getInstance<FastifyInstance>().log;
  }

  private write(
    logger: JsonEventLogger,
    fields: Record<string, unknown> & { event: OrderEvent },
  ): void {
    logger.info(fields, fields.event);
  }
}
