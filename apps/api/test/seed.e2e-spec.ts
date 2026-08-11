import type { DataSource } from 'typeorm';
import {
  createTestDataSource,
  recreateTestSchema,
  resetTestDatabase,
  seedTestDatabase,
} from './support/database';

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  description: string;
  price_cents: number;
  stock_on_hand: number;
  stock_reserved: number;
};

describe('database seed', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);
  });

  beforeEach(async () => {
    await resetTestDatabase(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('creates the deterministic catalog in an empty database', async () => {
    await seedTestDatabase(dataSource);

    const products = await dataSource.query<ProductRow[]>(`
      SELECT
        id,
        sku,
        name,
        description,
        price_cents,
        stock_on_hand,
        stock_reserved
      FROM products
      ORDER BY sku
    `);

    expect(products).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        sku: 'CASE-IP15-BLK',
        name: 'Capinha Impact iPhone 15',
        description: 'Proteção reforçada na cor preta',
        price_cents: 7990,
        stock_on_hand: 8,
        stock_reserved: 0,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        sku: 'CASE-P9-GRN',
        name: 'Capinha Soft Pixel 9',
        description: 'Silicone macio na cor verde',
        price_cents: 6990,
        stock_on_hand: 0,
        stock_reserved: 0,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        sku: 'CASE-S24-CLR',
        name: 'Capinha Crystal Galaxy S24',
        description: 'Proteção transparente de perfil fino',
        price_cents: 5990,
        stock_on_hand: 3,
        stock_reserved: 0,
      },
    ]);
  });

  it('preserves sold and reserved inventory while refreshing catalog fields on rerun', async () => {
    await seedTestDatabase(dataSource);
    await dataSource.query(
      `
        UPDATE products
        SET
          name = $1,
          description = $2,
          price_cents = $3,
          stock_on_hand = $4,
          stock_reserved = $5
        WHERE sku = $6
      `,
      ['Stale name', 'Stale description', 1, 5, 2, 'CASE-IP15-BLK'],
    );

    await seedTestDatabase(dataSource);

    const [product] = await dataSource.query<ProductRow[]>(
      `
        SELECT
          id,
          sku,
          name,
          description,
          price_cents,
          stock_on_hand,
          stock_reserved
        FROM products
        WHERE sku = $1
      `,
      ['CASE-IP15-BLK'],
    );

    expect(product).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      sku: 'CASE-IP15-BLK',
      name: 'Capinha Impact iPhone 15',
      description: 'Proteção reforçada na cor preta',
      price_cents: 7990,
      stock_on_hand: 5,
      stock_reserved: 2,
    });
  });
});
