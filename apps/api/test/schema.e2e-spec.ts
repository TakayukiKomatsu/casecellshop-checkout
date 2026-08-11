import type { DataSource } from 'typeorm';
import { createTestDataSource, recreateTestSchema } from './support/database';

describe('checkout schema', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('creates the checkout tables', async () => {
    const rows = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tableNames = rows.map((row) => row.table_name);

    expect(tableNames).toEqual(
      expect.arrayContaining(['products', 'orders', 'idempotency_records']),
    );
  });

  it('enforces catalog, order, and idempotency constraints', async () => {
    const constraints = await dataSource.query<
      { constraint_name: string; constraint_type: string; definition: string }[]
    >(`
      SELECT con.conname AS constraint_name,
             con.contype AS constraint_type,
             pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_namespace namespace ON namespace.oid = con.connamespace
      WHERE namespace.nspname = 'public'
    `);

    const expectConstraint = (
      constraintName: string,
      constraintType: string,
      definition: RegExp,
    ) => {
      const constraint = constraints.find(
        ({ constraint_name }) => constraint_name === constraintName,
      );

      expect(constraint).toEqual(
        expect.objectContaining({ constraint_type: constraintType }),
      );
      expect(constraint?.definition).toMatch(definition);
    };

    expectConstraint(
      'products_price_cents_nonnegative_check',
      'c',
      /price_cents\s*>=\s*0/i,
    );
    expectConstraint(
      'products_stock_on_hand_nonnegative_check',
      'c',
      /stock_on_hand\s*>=\s*0/i,
    );
    expectConstraint(
      'products_stock_reserved_valid_check',
      'c',
      /stock_reserved\s*>=\s*0.*stock_reserved\s*<=\s*stock_on_hand/i,
    );
    expectConstraint(
      'orders_quantity_positive_check',
      'c',
      /quantity\s*>\s*0/i,
    );
    expectConstraint(
      'orders_status_valid_check',
      'c',
      /PENDING.*PROCESSING.*COMPLETED.*FAILED/i,
    );
    expectConstraint(
      'idempotency_records_pkey',
      'p',
      /PRIMARY KEY\s*\("?key"?\)/i,
    );
    expectConstraint('products_sku_unique', 'u', /UNIQUE\s*\("?sku"?\)/i);
    expectConstraint(
      'idempotency_records_order_id_unique',
      'u',
      /UNIQUE\s*\("?order_id"?\)/i,
    );
  });
});
