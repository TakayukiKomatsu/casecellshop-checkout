import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('products')
@Unique('products_sku_unique', ['sku'])
@Check('products_price_cents_nonnegative_check', 'price_cents >= 0')
@Check('products_stock_on_hand_nonnegative_check', 'stock_on_hand >= 0')
@Check(
  'products_stock_reserved_valid_check',
  'stock_reserved >= 0 AND stock_reserved <= stock_on_hand',
)
export class ProductEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  sku!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ name: 'stock_on_hand', type: 'integer' })
  stockOnHand!: number;

  @Column({ name: 'stock_reserved', type: 'integer' })
  stockReserved!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
