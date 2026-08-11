import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ProductEntity } from '../catalog/product.entity';
import {
  InsufficientStockError,
  ProductNotFoundError,
} from '../checkout/checkout.errors';

@Injectable()
export class InventoryService {
  async reserve(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const product = await manager.getRepository(ProductEntity).findOne({
      where: { id: productId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!product) {
      throw new ProductNotFoundError();
    }

    const availableStock = product.stockOnHand - product.stockReserved;
    if (quantity > availableStock) {
      throw new InsufficientStockError(availableStock);
    }

    await manager.query(
      `UPDATE products
       SET stock_reserved = stock_reserved + $2,
           updated_at = now()
       WHERE id = $1`,
      [productId, quantity],
    );
  }

  async completeSale(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const [updated, updatedCount] = await manager.query<
      [Array<{ id: string }>, number]
    >(
      `UPDATE products
       SET stock_on_hand = stock_on_hand - $2,
           stock_reserved = stock_reserved - $2,
           updated_at = now()
       WHERE id = $1
         AND stock_on_hand >= $2
         AND stock_reserved >= $2
       RETURNING id`,
      [productId, quantity],
    );

    if (updatedCount !== 1 || !updated[0]) {
      throw new Error('Reserved stock could not be converted to a sale');
    }
  }

  async releaseReservation(
    manager: EntityManager,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const [updated, updatedCount] = await manager.query<
      [Array<{ id: string }>, number]
    >(
      `UPDATE products
       SET stock_reserved = stock_reserved - $2,
           updated_at = now()
       WHERE id = $1
         AND stock_reserved >= $2
       RETURNING id`,
      [productId, quantity],
    );

    if (updatedCount !== 1 || !updated[0]) {
      throw new Error('Reserved stock could not be released');
    }
  }
}
