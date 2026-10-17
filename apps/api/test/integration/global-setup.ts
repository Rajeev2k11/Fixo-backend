import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { Client, Pool } from 'pg';

const dotEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/**
 * Gives the run its own throwaway database (on the compose Postgres), Redis key prefix and storage
 * folder, so a running dev server and its workers never see test data. All are removed afterwards.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (existsSync(dotEnv)) process.loadEnvFile(dotEnv);
  const baseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!baseUrl || !redisUrl) throw new Error('DATABASE_URL/REDIS_URL not set (copy .env.example)');

  const name = `fixo_test_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);

  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.REDIS_KEY_PREFIX = name;
  process.env.STORAGE_LOCAL_DIR = `.data/${name}`; // uploaded files, removed afterwards

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  await pool.end();

  return async () => {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    const redis = new Redis(redisUrl);
    const keys = await redis.keys(`${name}:*`); // test-only Redis, so KEYS is fine here
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    rmSync(fileURLToPath(new URL(`../../../../.data/${name}`, import.meta.url)), {
      recursive: true,
      force: true,
    });
  };
}
