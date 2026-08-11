import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCheckoutSchema1720000000000 implements MigrationInterface {
  name = 'CreateCheckoutSchema1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL,
        "sku" text NOT NULL,
        "name" text NOT NULL,
        "description" text NOT NULL,
        "price_cents" integer NOT NULL,
        "stock_on_hand" integer NOT NULL,
        "stock_reserved" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "products_sku_unique" UNIQUE ("sku"),
        CONSTRAINT "products_price_cents_nonnegative_check"
          CHECK ("price_cents" >= 0),
        CONSTRAINT "products_stock_on_hand_nonnegative_check"
          CHECK ("stock_on_hand" >= 0),
        CONSTRAINT "products_stock_reserved_valid_check"
          CHECK (
            "stock_reserved" >= 0
            AND "stock_reserved" <= "stock_on_hand"
          )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "status" text NOT NULL,
        "failure_code" text NULL,
        "processing_started_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "orders_product_id_fk"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "orders_quantity_positive_check" CHECK ("quantity" > 0),
        CONSTRAINT "orders_status_valid_check"
          CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
      )
    `);

    await queryRunner.query(
      'CREATE INDEX "orders_product_id_idx" ON "orders" ("product_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "orders_status_idx" ON "orders" ("status")',
    );

    await queryRunner.query(`
      CREATE TABLE "idempotency_records" (
        "key" uuid NOT NULL,
        "request_fingerprint" text NOT NULL,
        "order_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key"),
        CONSTRAINT "idempotency_records_key_unique" UNIQUE ("key"),
        CONSTRAINT "idempotency_records_order_id_unique" UNIQUE ("order_id"),
        CONSTRAINT "idempotency_records_order_id_fk"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "idempotency_records"');
    await queryRunner.query('DROP INDEX "orders_status_idx"');
    await queryRunner.query('DROP INDEX "orders_product_id_idx"');
    await queryRunner.query('DROP TABLE "orders"');
    await queryRunner.query('DROP TABLE "products"');
  }
}
