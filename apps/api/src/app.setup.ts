import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';

/**
 * HTTP-level configuration shared by main.ts and the integration tests,
 * so the tests exercise exactly what runs in production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Security headers (HSTS, nosniff, frame-ancestors...) and no X-Powered-By.
  app.use(helmet());
  app.use(cookieParser());
  // credentials: the web app must send the refresh cookie to /auth/refresh.
  app.enableCors({ origin: config.get('WEB_URL', { infer: true }), credentials: true });
  // Closes the pg pool and the Redis client on SIGTERM (docker stop, k8s).
  app.enableShutdownHooks();
}
