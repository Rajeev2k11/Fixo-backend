import { INestApplication } from '@nestjs/common';

/**
 * App-wide HTTP configuration, shared by main.ts and the e2e tests so tests
 * exercise exactly what production runs.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
}
