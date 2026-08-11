import { ApiProperty } from '@nestjs/swagger';
import {
  ORDER_FAILURE_CODE,
  OrderStatus,
  type OrderFailureCode,
} from '../orders/order-status';

export type CreateOrderCommand = {
  idempotencyKey: string;
  productId: string;
  quantity: number;
};

export class OrderSnapshot {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  quantity!: number;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;

  @ApiProperty({
    enum: [ORDER_FAILURE_CODE],
    example: null,
    nullable: true,
  })
  failureCode!: OrderFailureCode | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreateOrderResult {
  @ApiProperty({
    description: 'True when the Idempotency-Key returned an existing order.',
  })
  replayed!: boolean;

  @ApiProperty({ type: OrderSnapshot })
  order!: OrderSnapshot;
}
