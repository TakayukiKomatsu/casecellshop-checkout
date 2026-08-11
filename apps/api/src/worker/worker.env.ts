import { config as loadDotenv } from 'dotenv';
import { ROOT_ENV_FILE, validateEnv } from '../config/env.schema';

loadDotenv({ path: ROOT_ENV_FILE, quiet: true });

export const env = validateEnv(process.env);
