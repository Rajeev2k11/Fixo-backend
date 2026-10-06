import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Temporary: replaced by the Zod-validated env config in step 1.2.
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on :${String(port)}`, 'Bootstrap');
}

void bootstrap();
