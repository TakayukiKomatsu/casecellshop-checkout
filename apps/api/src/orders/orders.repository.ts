import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { OrderSnapshot } from '../checkout/checkout.types';
import { OrderStatus, type OrderFailureCode } from './order-status';

type OrderRow = {
  id: string;
  product_id: string;
  quantity: number;
  status: OrderStatus;
  failure_code: OrderFailureCode | null;
  created_at: Date;
  updated_at: Date;
};

type ProcessingOrderRow = {
  id: string;
  product_id: string;
  quantity: number;
};

export type ProcessingOrder = {
  id: string;
  productId: string;
  quantity: number;
};

@Injectable()
export class OrdersRepository {
  async createPending(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<OrderSnapshot> {
    const rows = await manager.query<OrderRow[]>(
      `INSERT INTO orders (
         id,
         product_id,
         quantity,
         status,
         failure_code,
         processing_started_at,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, NULL, NULL, now(), now())
       RETURNING id, product_id, quantity, status, failure_code, created_at, updated_at`,
      [randomUUID(), productId, quantity, OrderStatus.Pending],
    );

    return this.toSnapshot(rows[0]);
  }

  async findById(
    manager: EntityManager,
    orderId: string,
  ): Promise<OrderSnapshot | null> {
    const rows = await manager.query<OrderRow[]>(
      `SELECT id, product_id, quantity, status, failure_code, created_at, updated_at
       FROM orders
       WHERE id = $1`,
      [orderId],
    );

    return rows[0] ? this.toSnapshot(rows[0]) : null;
  }

  async claimNextPending(
    manager: EntityManager,
  ): Promise<ProcessingOrder | null> {
    const pending = await manager.query<ProcessingOrderRow[]>(
      `SELECT id, product_id, quantity
       FROM orders
       WHERE status = $1
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [OrderStatus.Pending],
    );

    if (!pending[0]) {
      return null;
    }

    const [claimed, claimedCount] = await manager.query<
      [ProcessingOrderRow[], number]
    >(
      `UPDATE orders
       SET status = $2,
           processing_started_at = now(),
           updated_at = now()
       WHERE id = $1 AND status = $3
       RETURNING id, product_id, quantity`,
      [pending[0].id, OrderStatus.Processing, OrderStatus.Pending],
    );

    if (claimedCount !== 1 || !claimed[0]) {
      throw new Error('Locked pending order could not be claimed');
    }

    return this.toProcessingOrder(claimed[0]);
  }

  async finalizeProcessing(
    manager: EntityManager,
    orderId: string,
    status: OrderStatus.Completed | OrderStatus.Failed,
    failureCode: OrderFailureCode | null,
  ): Promise<ProcessingOrder | null> {
    const [finalized, finalizedCount] = await manager.query<
      [ProcessingOrderRow[], number]
    >(
      `UPDATE orders
       SET status = $2,
           failure_code = $3,
           updated_at = now()
       WHERE id = $1 AND status = $4
       RETURNING id, product_id, quantity`,
      [orderId, status, failureCode, OrderStatus.Processing],
    );

    if (finalizedCount === 0) {
      return null;
    }
    if (finalizedCount !== 1 || !finalized[0]) {
      throw new Error('Processing order could not be finalized exactly once');
    }

    return this.toProcessingOrder(finalized[0]);
  }

  private toProcessingOrder(row: ProcessingOrderRow): ProcessingOrder {
    return {
      id: row.id,
      productId: row.product_id,
      quantity: row.quantity,
    };
  }

  private toSnapshot(row: OrderRow): OrderSnapshot {
    return {
      id: row.id,
      productId: row.product_id,
      quantity: row.quantity,
      status: row.status,
      failureCode: row.failure_code,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
