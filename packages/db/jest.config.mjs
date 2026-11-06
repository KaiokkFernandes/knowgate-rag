/** @type {import('jest').Config} */
const config = {
  // The package is ESM ("type": "module"): ts-jest emits ESM and Jest runs it
  // with --experimental-vm-modules (see the test:integration script).
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.int\\.spec\\.ts$',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Pulling the image and starting Postgres can take a while on the first run.
  testTimeout: 120_000,
};

export default config;
