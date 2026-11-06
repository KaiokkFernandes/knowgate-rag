/**
 * Integration tests: real Postgres (pgvector) and Redis started once by Testcontainers
 * in globalSetup, with the real migrations applied. Requires Docker.
 * @type {import('jest').Config}
 */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // Dynamic imports use ESM-style specifiers (".js") under nodenext; map them to the .ts sources.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  testTimeout: 60_000,
};

export default config;
