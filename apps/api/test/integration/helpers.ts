import { randomInt } from 'node:crypto';

import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';

import type { OtpSmsJob } from '../../src/platform/sms/sms.js';

/** A bare user row, for tests that need a real actor (audit and config actors are foreign keys). */
export async function createUser(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into "user" default values returning id',
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('user insert returned no row');
  return id;
}

/** A random, valid Indian mobile number (10 digits, no +91). */
export const newPhone = (): string => `9${String(randomInt(0, 1e9)).padStart(9, '0')}`;

/** The OTP the SMS worker would send to this phone (latest queued job; no worker runs in tests). */
export async function sentCode(smsQueue: Queue<OtpSmsJob>, phone: string): Promise<string> {
  const jobs = await smsQueue.getJobs(['waiting', 'prioritized', 'delayed']);
  const mine = jobs
    .filter((j) => j.data.phone === `+91${phone}`)
    .toSorted((a, b) => b.timestamp - a.timestamp);
  const code = mine[0]?.data.code;
  if (!code) throw new Error(`no SMS queued for ${phone}`);
  return code;
}

const SYSTEM_USER = '00000000-0000-0000-0000-000000000001';

/**
 * Puts shared state back: config as the migrations seeded it, and no rate-limit counters or
 * cooldowns. Call in afterAll of any test file that changes config or sends OTPs, so files never
 * depend on the order they run in (vitest orders files by previous duration, not by name).
 */
export async function resetSharedState(pool: Pool): Promise<void> {
  await pool.query('delete from config_rule where created_by <> $1', [SYSTEM_USER]);
  await pool.query('update config_rule set effective_to = null where created_by = $1', [
    SYSTEM_USER,
  ]);
  const redis = new Redis(process.env.REDIS_URL ?? '');
  const prefix = process.env.REDIS_KEY_PREFIX ?? '';
  const keys = [...(await redis.keys(`${prefix}:rl:*`)), ...(await redis.keys(`${prefix}:cd:*`))];
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}
