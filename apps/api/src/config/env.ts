import { z } from 'zod';

/**
 * Environment variables the API needs to boot.
 * Validated once at startup (fail fast): if something is missing or malformed,
 * the process exits with a clear error instead of failing later at runtime.
 * New variables are added here as each phase starts using them.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    // Only variable names and issues are printed, never the values (they may hold secrets).
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
