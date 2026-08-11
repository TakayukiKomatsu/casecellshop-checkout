import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ROOT_ENV_FILE, validateEnv } from '../../src/config/env.schema';
import { seedDatabase } from '../../src/database/seed';
import { createDataSourceOptions } from '../../src/database/typeorm.config';

loadDotenv({ path: ROOT_ENV_FILE });

const env = validateEnv(process.env);

export function createTestDataSource(): DataSource {
  return new DataSource(createDataSourceOptions(env.DATABASE_URL_TEST));
}

function assertIsolatedTestDatabase(connection: DataSource): void {
  if (connection.options.type !== 'postgres') {
    throw new Error('Test database helpers require PostgreSQL');
  }

  if (connection.options.url !== env.DATABASE_URL_TEST) {
    throw new Error(
      'Refusing to reset a database other than DATABASE_URL_TEST',
    );
  }
}

export async function migrateTestDatabase(
  connection: DataSource,
): Promise<void> {
  assertIsolatedTestDatabase(connection);
  await connection.runMigrations({ transaction: 'all' });
}

export async function recreateTestSchema(
  connection: DataSource,
): Promise<void> {
  assertIsolatedTestDatabase(connection);
  await connection.query('DROP SCHEMA public CASCADE');
  await connection.query('CREATE SCHEMA public');
  await migrateTestDatabase(connection);
}

export async function resetTestDatabase(connection: DataSource): Promise<void> {
  assertIsolatedTestDatabase(connection);
  await connection.query(`
    TRUNCATE TABLE idempotency_records, orders, products
    RESTART IDENTITY CASCADE
  `);
}

export async function seedTestDatabase(connection: DataSource): Promise<void> {
  assertIsolatedTestDatabase(connection);
  await seedDatabase(connection);
}
