import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { OrderEntity } from './order.entity';

@Entity('idempotency_records')
@Unique('idempotency_records_key_unique', ['key'])
@Unique('idempotency_records_order_id_unique', ['orderId'])
export class IdempotencyRecordEntity {
  @PrimaryColumn('uuid')
  key!: string;

  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint!: string;

  @Column({ name: 'order_id', nullable: true, type: 'uuid' })
  orderId!: string | null;

  @OneToOne(() => OrderEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'idempotency_records_order_id_fk',
  })
  order!: OrderEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
