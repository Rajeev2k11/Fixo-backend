import { Controller, Get, Inject } from '@nestjs/common';
import { ErrorCode } from '@fixo/contracts';
import { sql } from 'drizzle-orm';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';

/** Liveness plus database reachability. A Redis check joins once the API itself uses Redis (step 1.9). */
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch (cause) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, 'Database unavailable', null, {
        cause,
      });
    }
    return { status: 'ok' };
  }
}
