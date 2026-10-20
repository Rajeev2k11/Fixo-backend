import { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { env } from './common/env.js';

/**
 * App-wide HTTP configuration, shared by main.ts and the e2e tests so tests
 * exercise exactly what production runs.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('v1');
  // Only listed browser origins get CORS headers; requests without an Origin (native apps,
  // curl, server-to-server) are not affected by CORS at all.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true, // admin web sends its refresh cookie
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replayed'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
