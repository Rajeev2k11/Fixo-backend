import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

const dotEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/**
 * Creates a throwaway database on the compose Postgres, migrates it, and points
 * DATABASE_URL at it for the test workers. Dropped afterwards, so dev data is never touched.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (existsSync(dotEnv)) process.loadEnvFile(dotEnv);
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

  const name = `fixo_test_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);

  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = testUrl.toString();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  await pool.end();

  return async () => {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  };
}
