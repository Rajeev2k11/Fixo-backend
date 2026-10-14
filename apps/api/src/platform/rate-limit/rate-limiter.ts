import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS, redisKey } from '../../common/redis.js';

export interface Hit {
  allowed: boolean;
  /** Hits so far in this window, including this one. */
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters and cooldowns in Redis.
 * ponytail: a fixed window allows up to 2x max across a window boundary; switch to a sliding
 * window if that burst is ever abused.
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts a hit against `key` (rejected hits count too, so hammering never resets the window). */
  async hit(key: string, max: number, windowSeconds: number): Promise<Hit> {
    const k = redisKey(`rl:${key}`);
    const replies = await this.redis
      .multi()
      .set(k, 0, 'EX', windowSeconds, 'NX') // starts the window and its expiry atomically
      .incr(k)
      .pttl(k)
      .exec();
    const count = Number(replies?.[1]?.[1]);
    const ttlMs = Number(replies?.[2]?.[1]);
    return {
      allowed: count <= max,
      count,
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }

  /** Seconds left on a cooldown, 0 if none. */
  async cooldownLeft(key: string): Promise<number> {
    const ttlMs = await this.redis.pttl(redisKey(`cd:${key}`));
    return ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0;
  }

  async startCooldown(key: string, seconds: number): Promise<void> {
    if (seconds > 0) await this.redis.set(redisKey(`cd:${key}`), 1, 'EX', seconds);
  }
}
