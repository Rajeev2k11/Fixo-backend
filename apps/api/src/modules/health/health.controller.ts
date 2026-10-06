import { Controller, Get } from '@nestjs/common';

/**
 * Liveness only: the process is up and serving HTTP.
 * Database and Redis readiness checks are added in step 1.3.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
