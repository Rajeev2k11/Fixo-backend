import { ErrorCode } from '@fixo/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { REDIS } from '../../common/redis.js';

/** Liveness plus reachability of the database and Redis. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    const [database, redis] = await Promise.allSettled([
      this.db.execute(sql`select 1`),
      this.redis.ping(),
    ]);
    if (database.status === 'rejected' || redis.status === 'rejected') {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, 'A dependency is unavailable', {
        database: database.status === 'fulfilled' ? 'up' : 'down',
        redis: redis.status === 'fulfilled' ? 'up' : 'down',
      });
    }
    return { status: 'ok' };
  }
}
