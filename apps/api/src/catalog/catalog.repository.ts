import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CatalogProduct } from './catalog.types';

@Injectable()
export class CatalogRepository {
  constructor(private readonly dataSource: DataSource) {}

  list(): Promise<CatalogProduct[]> {
    return this.dataSource.query<CatalogProduct[]>(`
      SELECT
        id,
        sku,
        name,
        description,
        price_cents AS "priceCents",
        stock_on_hand - stock_reserved AS "availableStock"
      FROM products
      ORDER BY id
    `);
  }
}
