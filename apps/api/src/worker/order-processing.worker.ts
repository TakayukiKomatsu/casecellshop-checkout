import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import {
  ERP_PROCESSOR_PORT,
  type ErpProcessingResult,
  type ErpProcessorPort,
} from '../erp/erp-processor.port';
import { InventoryService } from '../inventory/inventory.service';
import { OrderEvents } from '../observability/order-events';
import {
  OrdersRepository,
  type ProcessingOrder,
} from '../orders/orders.repository';
import { ORDER_FAILURE_CODE, OrderStatus } from '../orders/order-status';
import { env } from './worker.env';

@Injectable()
export class OrderProcessingWorker {
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryService,
    @Inject(ERP_PROCESSOR_PORT)
    private readonly erp: ErpProcessorPort,
    @Optional()
    private readonly events?: OrderEvents,
  ) {}

  @Interval(env.WORKER_POLL_MS)
  async poll(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    let claimed: ProcessingOrder | null = null;
    const correlationId = randomUUID();
    const claimStartedAt = performance.now();
    let processingStartedAt = 0;

    try {
      this.erp.assertReady?.();
      claimed = await this.dataSource.transaction(
        'READ COMMITTED',
        (manager: EntityManager) => this.orders.claimNextPending(manager),
      );
      if (!claimed) {
        return;
      }
      this.events?.processingStarted(
        correlationId,
        claimed.id,
        performance.now() - claimStartedAt,
      );
      processingStartedAt = performance.now();

      const result = await this.erp.process({
        operationId: claimed.id,
        productId: claimed.productId,
        quantity: claimed.quantity,
      });

      const finalized = await this.finalize(claimed.id, result);
      if (finalized) {
        const durationMs = performance.now() - processingStartedAt;
        if (result.ok) {
          this.events?.completed(correlationId, claimed.id, durationMs);
        } else {
          this.events?.failed(
            correlationId,
            claimed.id,
            durationMs,
            result.code,
          );
        }
      }
    } catch (error) {
      if (!claimed) {
        throw error;
      }
      // A claimed order intentionally remains PROCESSING after interruption.
    } finally {
      this.running = false;
    }
  }

  private async finalize(
    orderId: string,
    result: ErpProcessingResult,
  ): Promise<boolean> {
    return this.dataSource.transaction(
      'READ COMMITTED',
      async (manager: EntityManager) => {
        const order = await this.orders.finalizeProcessing(
          manager,
          orderId,
          result.ok ? OrderStatus.Completed : OrderStatus.Failed,
          result.ok ? null : ORDER_FAILURE_CODE,
        );
        if (!order) {
          return false;
        }

        if (result.ok) {
          await this.inventory.completeSale(
            manager,
            order.productId,
            order.quantity,
          );
          return true;
        }

        await this.inventory.releaseReservation(
          manager,
          order.productId,
          order.quantity,
        );
        return true;
      },
    );
  }
}
