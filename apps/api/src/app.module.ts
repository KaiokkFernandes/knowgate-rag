import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Single .env at the monorepo root (dev). In containers, real env vars win.
      envFilePath: '../../.env',
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
