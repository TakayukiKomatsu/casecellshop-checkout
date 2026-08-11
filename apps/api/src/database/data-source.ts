import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ROOT_ENV_FILE, validateEnv } from '../config/env.schema';
import { createDataSourceOptions } from './typeorm.config';

loadDotenv({ path: ROOT_ENV_FILE });

const env = validateEnv(process.env);
const databaseTarget = process.env.DATABASE_TARGET ?? 'default';

if (!['default', 'test'].includes(databaseTarget)) {
  throw new Error('DATABASE_TARGET must be either default or test');
}

const databaseUrl =
  databaseTarget === 'test' ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export default new DataSource(createDataSourceOptions(databaseUrl));
