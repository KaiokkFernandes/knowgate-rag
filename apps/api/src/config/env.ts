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
  // HS256 key: at least 256 bits. Generate with `openssl rand -hex 32`.
  JWT_SECRET: z.string().min(32, { error: 'JWT_SECRET must have at least 32 characters' }),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Requests per minute per IP: every route / login and register (brute-force protection).
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  // Daily token budget given to new organizations (usage limit, phase 3).
  DAILY_TOKEN_LIMIT_DEFAULT: z.coerce.number().int().positive().default(200_000),
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
