import { z } from 'zod';

/**
 * Environment variables the API needs to boot.
 * Validated once at startup (fail fast): if something is missing or malformed,
 * the process exits with a clear error instead of failing later at runtime.
 * New variables are added here as each phase starts using them.
 */
export const envSchema = z
  .object({
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
    // Largest accepted upload (10 MB).
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
    // Chunk size in estimated tokens and the overlap between consecutive chunks (README).
    CHUNK_TARGET_TOKENS: z.coerce.number().int().min(50).default(400),
    CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(60),
    // `fake`: deterministic local vectors, no network and no cost (tests and local development).
    EMBEDDING_PROVIDER: z.enum(['voyage', 'fake']).default('voyage'),
    VOYAGE_API_KEY: z.string().optional(),
    VOYAGE_MODEL: z.string().default('voyage-4-large'),
    // Must match the vector(1024) column; changing it requires a migration.
    EMBEDDING_DIMENSION: z.coerce.number().pipe(z.literal(1024)).default(1024),
    // `fake`: deterministic offline answers that cite the first source (tests, local development).
    LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_MODEL: z.string().default('claude-haiku-5-5'),
    // Grounded Q&A over a few short sources: low effort keeps latency and cost down.
    CLAUDE_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    // Hard cap per answer (cost control); answers are a few paragraphs.
    CLAUDE_MAX_TOKENS: z.coerce.number().int().min(256).max(16_000).default(2048),
    // "No basis, no answer": sources below this cosine similarity are not sent to the model.
    CHAT_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.4),
    CHAT_MAX_SOURCES: z.coerce.number().int().min(1).max(20).default(6),
  })
  .refine((env) => env.CHUNK_OVERLAP_TOKENS < env.CHUNK_TARGET_TOKENS, {
    path: ['CHUNK_OVERLAP_TOKENS'],
    error: 'CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_TARGET_TOKENS',
  })
  .refine((env) => env.EMBEDDING_PROVIDER !== 'voyage' || !!env.VOYAGE_API_KEY, {
    path: ['VOYAGE_API_KEY'],
    error: 'VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage',
  })
  // Tests never call paid APIs (CLAUDE.md §9), even if a real key is present in .env.
  .refine((env) => env.NODE_ENV !== 'test' || env.EMBEDDING_PROVIDER === 'fake', {
    path: ['EMBEDDING_PROVIDER'],
    error: 'Tests must use EMBEDDING_PROVIDER=fake',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.EMBEDDING_PROVIDER !== 'fake', {
    path: ['EMBEDDING_PROVIDER'],
    error: 'The fake embedding provider is not allowed in production',
  })
  .refine((env) => env.LLM_PROVIDER !== 'anthropic' || !!env.ANTHROPIC_API_KEY, {
    path: ['ANTHROPIC_API_KEY'],
    error: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
  })
  .refine((env) => env.NODE_ENV !== 'test' || env.LLM_PROVIDER === 'fake', {
    path: ['LLM_PROVIDER'],
    error: 'Tests must use LLM_PROVIDER=fake',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.LLM_PROVIDER !== 'fake', {
    path: ['LLM_PROVIDER'],
    error: 'The fake LLM provider is not allowed in production',
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
