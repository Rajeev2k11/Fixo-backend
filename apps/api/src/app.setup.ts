import { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

/**
 * App-wide HTTP configuration, shared by main.ts and the e2e tests so tests
 * exercise exactly what production runs.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
}
