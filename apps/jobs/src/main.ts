import 'reflect-metadata';

import { JobsModule } from '@fixo/api/jobs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap(): Promise<void> {
  // An application context: same Nest modules and DI as the API, but no HTTP server.
  const app = await NestFactory.createApplicationContext(JobsModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  Logger.log('Jobs process ready: outbox relay running', 'Bootstrap');
}

void bootstrap();
