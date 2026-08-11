import { join } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { ProductEntity } from '../catalog/product.entity';
import { IdempotencyRecordEntity } from '../orders/idempotency-record.entity';
import { OrderEntity } from '../orders/order.entity';

const entities = [ProductEntity, OrderEntity, IdempotencyRecordEntity];
const migrations = [join(__dirname, 'migrations/*{.ts,.js}')];

export function createTypeOrmOptions(
  databaseUrl: string,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations,
    migrationsRun: false,
    synchronize: false,
  };
}

export function createDataSourceOptions(
  databaseUrl: string,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations,
    migrationsRun: false,
    synchronize: false,
  };
}
