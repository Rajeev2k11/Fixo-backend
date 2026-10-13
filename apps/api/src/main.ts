import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { env } from './common/env.js';

async function bootstrap(): Promise<void> {
  // bufferLogs: hold Nest's startup logs until the pino logger is attached, so they are JSON too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  await app.listen(env.API_PORT);
  Logger.log(`API listening on :${String(env.API_PORT)}`, 'Bootstrap');
}

void bootstrap();
