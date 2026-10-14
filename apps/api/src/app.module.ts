import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { DbModule } from './common/db.js';
import { env } from './common/env.js';
import { loggerParams } from './common/logger.js';
import { RedisModule } from './common/redis.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ConfigModule } from './modules/config/config.module.js';
import { DocsModule } from './modules/docs/docs.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { IdempotencyInterceptor } from './platform/idempotency/idempotency.interceptor.js';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(env)),
    DbModule,
    RedisModule,
    ConfigModule,
    UsersModule,
    AuthModule,
    HealthModule,
    // API docs are for development; production does not expose them.
    ...(env.NODE_ENV === 'production' ? [] : [DocsModule]),
  ],
  // Global, but a no-op unless a route is marked @Idempotent().
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
