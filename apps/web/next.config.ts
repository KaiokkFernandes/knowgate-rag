import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server (server.js + traced node_modules) for the Docker image.
  output: 'standalone',
  // Trace from the monorepo root so workspace packages (@knowgate/shared) are included.
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
