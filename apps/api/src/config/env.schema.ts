import { resolve } from 'node:path';
import { z } from 'zod';

const databaseUrlSchema = z
  .string()
  .min(1)
  .url()
  .refine(
    (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    'Expected a PostgreSQL connection URL',
  );

const millisecondsSchema = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value)),
]);
const simulationResultSchema = z.enum(['success', 'failure']);

export const ROOT_ENV_FILE = resolve(__dirname, '../../../../.env');

export const appEnvSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    DATABASE_URL_TEST: databaseUrlSchema,
    WORKER_POLL_MS: millisecondsSchema,
    ERP_SIMULATION_DELAY_MS: millisecondsSchema,
    ERP_SIMULATION_MODE: z.enum(['success', 'failure', 'scripted']),
    ERP_SIMULATION_SCRIPT: z.string(),
  })
  .superRefine((env, context) => {
    if (env.ERP_SIMULATION_MODE === 'scripted') {
      const script = env.ERP_SIMULATION_SCRIPT.split(',').map((value) =>
        value.trim(),
      );
      const hasValidScript =
        script.length > 0 &&
        script.every(
          (value) =>
            value.length > 0 && simulationResultSchema.safeParse(value).success,
        );

      if (!hasValidScript) {
        context.addIssue({
          code: 'custom',
          message:
            'Expected a non-empty comma-separated success/failure sequence',
          path: ['ERP_SIMULATION_SCRIPT'],
        });
      }
    }

    if (env.DATABASE_URL === env.DATABASE_URL_TEST) {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL_TEST must identify an isolated database',
        path: ['DATABASE_URL_TEST'],
      });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  return appEnvSchema.parse(config);
}
