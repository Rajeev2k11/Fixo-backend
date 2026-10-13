import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { env } from './common/env.js';
import { loggerParams } from './common/logger.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [LoggerModule.forRoot(loggerParams(env)), HealthModule],
})
export class AppModule {}
