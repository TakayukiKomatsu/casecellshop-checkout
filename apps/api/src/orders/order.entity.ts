import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductEntity } from '../catalog/product.entity';
import { type OrderFailureCode, OrderStatus } from './order-status';

@Entity('orders')
@Check('orders_quantity_positive_check', 'quantity > 0')
@Check(
  'orders_status_valid_check',
  "status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')",
)
@Index('orders_status_idx', ['status'])
export class OrderEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'orders_product_id_fk',
  })
  product!: ProductEntity;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ name: 'failure_code', nullable: true, type: 'text' })
  failureCode!: OrderFailureCode | null;

  @Column({
    name: 'processing_started_at',
    nullable: true,
    type: 'timestamptz',
  })
  processingStartedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
