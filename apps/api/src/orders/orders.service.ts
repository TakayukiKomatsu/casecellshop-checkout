import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderNotFoundError } from '../checkout/checkout.errors';
import type { OrderSnapshot } from '../checkout/checkout.types';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: OrdersRepository,
  ) {}

  async findById(orderId: string): Promise<OrderSnapshot> {
    const order = await this.orders.findById(this.dataSource.manager, orderId);
    if (!order) {
      throw new OrderNotFoundError();
    }

    return order;
  }
}
