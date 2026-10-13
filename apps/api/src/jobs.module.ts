import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';

import { DbModule } from './common/db.js';
import { env } from './common/env.js';
import { loggerParams } from './common/logger.js';
import { DOMAIN_EVENTS_QUEUE, EVENT_QUEUE, OutboxRelay } from './platform/outbox/outbox-relay.js';

const REDIS = Symbol('REDIS');

/**
 * Root module of the background worker process (apps/jobs). Lives in the API package so both
 * processes share the same modules: same code, separate entry point.
 */
@Module({
  imports: [LoggerModule.forRoot(loggerParams(env)), DbModule],
  providers: [
    // BullMQ requires maxRetriesPerRequest: null on connections used by workers.
    { provide: REDIS, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) },
    {
      provide: EVENT_QUEUE,
      inject: [REDIS],
      useFactory: (connection: Redis) => new Queue(DOMAIN_EVENTS_QUEUE, { connection }),
    },
    OutboxRelay,
  ],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(
    @Inject(EVENT_QUEUE) private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // A connection we pass in is ours to close; BullMQ only closes connections it created.
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }
}
