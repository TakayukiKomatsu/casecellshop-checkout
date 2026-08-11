import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersRepository } from '../orders/orders.repository';
import { IdempotencyKeyReusedError } from './checkout.errors';
import type { CreateOrderCommand, CreateOrderResult } from './checkout.types';

export const CHECKOUT_PRE_COMMIT_HOOK = Symbol('CHECKOUT_PRE_COMMIT_HOOK');
export type CheckoutPreCommitHook = () => Promise<void> | void;

type IdempotencyRecordRow = {
  request_fingerprint: string;
  order_id: string | null;
};

@Injectable()
export class CheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersRepository,
    @Inject(CHECKOUT_PRE_COMMIT_HOOK)
    private readonly beforeCommit: CheckoutPreCommitHook,
  ) {}

  createOrder(command: CreateOrderCommand): Promise<CreateOrderResult> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([command.productId, command.quantity]))
      .digest('hex');

    return this.dataSource.transaction(
      'READ COMMITTED',
      async (manager: EntityManager): Promise<CreateOrderResult> => {
        const claimed = await manager.query<Array<{ key: string }>>(
          `INSERT INTO idempotency_records (key, request_fingerprint, created_at)
           VALUES ($1, $2, now())
           ON CONFLICT DO NOTHING
           RETURNING key`,
          [command.idempotencyKey, fingerprint],
        );

        if (claimed.length === 0) {
          return this.replayExisting(
            manager,
            command.idempotencyKey,
            fingerprint,
          );
        }

        await this.inventory.reserve(
          manager,
          command.productId,
          command.quantity,
        );
        const order = await this.orders.createPending(
          manager,
          command.productId,
          command.quantity,
        );
        await manager.query(
          `UPDATE idempotency_records
           SET order_id = $2
           WHERE key = $1`,
          [command.idempotencyKey, order.id],
        );
        await this.beforeCommit();

        return { replayed: false, order };
      },
    );
  }

  private async replayExisting(
    manager: EntityManager,
    key: string,
    fingerprint: string,
  ): Promise<CreateOrderResult> {
    const rows = await manager.query<IdempotencyRecordRow[]>(
      `SELECT request_fingerprint, order_id
       FROM idempotency_records
       WHERE key = $1`,
      [key],
    );
    const record = rows[0];

    if (!record?.order_id) {
      throw new Error('Committed idempotency record has no order');
    }
    if (record.request_fingerprint !== fingerprint) {
      throw new IdempotencyKeyReusedError();
    }

    const order = await this.orders.findById(manager, record.order_id);
    if (!order) {
      throw new Error('Idempotency record references a missing order');
    }

    return { replayed: true, order };
  }
}
