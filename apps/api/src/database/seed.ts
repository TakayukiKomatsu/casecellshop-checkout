import type { DataSource } from 'typeorm';

export const SEEDED_PRODUCTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'CASE-IP15-BLK',
    name: 'Capinha Impact iPhone 15',
    description: 'Proteção reforçada na cor preta',
    priceCents: 7990,
    stockOnHand: 8,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'CASE-S24-CLR',
    name: 'Capinha Crystal Galaxy S24',
    description: 'Proteção transparente de perfil fino',
    priceCents: 5990,
    stockOnHand: 3,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    sku: 'CASE-P9-GRN',
    name: 'Capinha Soft Pixel 9',
    description: 'Silicone macio na cor verde',
    priceCents: 6990,
    stockOnHand: 0,
  },
] as const;

export async function seedDatabase(connection: DataSource): Promise<void> {
  const values = SEEDED_PRODUCTS.flatMap((product) => [
    product.id,
    product.sku,
    product.name,
    product.description,
    product.priceCents,
    product.stockOnHand,
  ]);

  await connection.query(
    `
      INSERT INTO products (
        id,
        sku,
        name,
        description,
        price_cents,
        stock_on_hand,
        stock_reserved
      )
      VALUES
        ($1, $2, $3, $4, $5, $6, 0),
        ($7, $8, $9, $10, $11, $12, 0),
        ($13, $14, $15, $16, $17, $18, 0)
      ON CONFLICT (sku) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price_cents = EXCLUDED.price_cents,
        updated_at = now()
    `,
    values,
  );
}
