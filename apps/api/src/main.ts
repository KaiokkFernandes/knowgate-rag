import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Closes the pg pool and the Redis client on SIGTERM (docker stop, k8s).
  app.enableShutdownHooks();
  // Security headers (HSTS, nosniff, frame-ancestors...) and no X-Powered-By.
  app.use(helmet());
  app.use(cookieParser());
  // credentials: the web app must send the refresh cookie to /auth/refresh.
  app.enableCors({ origin: config.get('WEB_URL', { infer: true }), credentials: true });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
