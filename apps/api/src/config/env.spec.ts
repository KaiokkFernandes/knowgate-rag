import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts the fake provider in tests and Voyage with a key in production', () => {
    expect(
      validateEnv({ ...base, NODE_ENV: 'test', EMBEDDING_PROVIDER: 'fake', LLM_PROVIDER: 'fake' }),
    ).toMatchObject({
      EMBEDDING_PROVIDER: 'fake',
      EMBEDDING_DIMENSION: 1024,
    });
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', VOYAGE_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }),
    ).toMatchObject({
      EMBEDDING_PROVIDER: 'voyage',
      VOYAGE_MODEL: 'voyage-4-large',
      LLM_PROVIDER: 'anthropic',
      CLAUDE_MODEL: 'claude-haiku-5-5',
    });
  });

  it.each([
    ['tests calling the paid API', { NODE_ENV: 'test', VOYAGE_API_KEY: 'k' }, 'EMBEDDING_PROVIDER'],
    [
      'the fake provider in production',
      { NODE_ENV: 'production', EMBEDDING_PROVIDER: 'fake' },
      'EMBEDDING_PROVIDER',
    ],
    ['Voyage without a key', { NODE_ENV: 'development' }, 'VOYAGE_API_KEY'],
    [
      'tests calling Claude',
      { NODE_ENV: 'test', EMBEDDING_PROVIDER: 'fake', ANTHROPIC_API_KEY: 'k' },
      'LLM_PROVIDER',
    ],
    [
      'the fake LLM in production',
      { NODE_ENV: 'production', VOYAGE_API_KEY: 'k', LLM_PROVIDER: 'fake' },
      'LLM_PROVIDER',
    ],
    [
      'Claude without a key',
      { NODE_ENV: 'development', EMBEDDING_PROVIDER: 'fake' },
      'ANTHROPIC_API_KEY',
    ],
    [
      'a dimension other than the vector(1024) column',
      { EMBEDDING_PROVIDER: 'fake', EMBEDDING_DIMENSION: '512' },
      'EMBEDDING_DIMENSION',
    ],
    [
      'an overlap not smaller than the chunk',
      { EMBEDDING_PROVIDER: 'fake', CHUNK_TARGET_TOKENS: '100', CHUNK_OVERLAP_TOKENS: '100' },
      'CHUNK_OVERLAP_TOKENS',
    ],
  ])('rejects %s', (_case, env, key) => {
    expect(() => validateEnv({ ...base, ...env })).toThrow(key);
  });

  it('never prints secret values in the error', () => {
    const error = (() => {
      try {
        validateEnv({ ...base, JWT_SECRET: 'short-secret-value' });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain('JWT_SECRET');
    expect(error?.message).not.toContain('short-secret-value');
  });
});
