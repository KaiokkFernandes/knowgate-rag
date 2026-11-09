import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';
import { UsersModule } from './users/users.module';

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
    SecurityModule,
    HealthModule,
    // Order matters: global guards run in registration order, so the JWT guard (AuthModule)
    // authenticates the user before OrgAccessGuard (OrganizationsModule) checks membership.
    AuthModule,
    OrganizationsModule,
    UsersModule,
  ],
})
export class AppModule {}
