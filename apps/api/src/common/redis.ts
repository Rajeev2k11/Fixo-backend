import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

import { env } from './env.js';

export const REDIS = Symbol('REDIS');

/** Every BullMQ queue and worker uses this prefix, so environments sharing a Redis stay apart. */
export const queuePrefix = `${env.REDIS_KEY_PREFIX}:bull`;

/** Prefix for plain keys (rate limits, cooldowns). */
export const redisKey = (key: string): string => `${env.REDIS_KEY_PREFIX}:${key}`;

/**
 * Connection options for BullMQ. Passing options (not a shared client) lets each Queue/Worker own
 * its connection and close it in close(), so shutdown order between them never matters.
 */
export function redisOptions(): ConnectionOptions {
  return { url: env.REDIS_URL, maxRetriesPerRequest: null }; // null is required by BullMQ workers
}

/** The API's own Redis client (rate limits, health). Fails fast instead of queueing commands forever. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const client = new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 5_000,
        });
        const logger = new Logger('Redis');
        client.on('error', (err: Error) => {
          logger.warn(err.message);
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
