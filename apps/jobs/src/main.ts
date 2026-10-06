import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { JobsModule } from './jobs.module.js';

async function bootstrap(): Promise<void> {
  // An application context: same Nest modules and DI as the API, but no HTTP server.
  const app = await NestFactory.createApplicationContext(JobsModule);
  app.enableShutdownHooks();
  Logger.log('Jobs process ready (no workers registered yet)', 'Bootstrap');
}

void bootstrap();
