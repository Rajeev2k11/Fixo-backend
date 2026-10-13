import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/*.schema.ts',
  out: './db/migrations',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
});
