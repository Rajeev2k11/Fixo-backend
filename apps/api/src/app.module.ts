import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { DbModule } from './common/db.js';
import { env } from './common/env.js';
import { loggerParams } from './common/logger.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdempotencyInterceptor } from './platform/idempotency/idempotency.interceptor.js';

@Module({
  imports: [LoggerModule.forRoot(loggerParams(env)), DbModule, HealthModule],
  // Global, but a no-op unless a route is marked @Idempotent().
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
