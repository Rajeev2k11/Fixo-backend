import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    // Namespaces every Redis key and queue, so tests and environments sharing a Redis never collide.
    REDIS_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .default('fixo'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Keys the HMACs of OTP codes and phone numbers. Generate with `openssl rand -hex 32`.
    OTP_HMAC_SECRET: z.string().min(32),
    // Signs access tokens (HS256). Generate with `openssl rand -hex 32`; rotating it logs everyone out
    // within one access-token lifetime (refresh tokens keep working).
    JWT_SECRET: z.string().min(32),
    // AES-256-GCM key for admin MFA secrets at rest: 32 bytes as hex (`openssl rand -hex 32`).
    MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters'),
    // Real providers (MSG91) are added when chosen; until then only the console fake exists.
    SMS_PROVIDER: z.enum(['fake']).default('fake'),
    // Private file storage. Cloudflare R2 is added when credentials exist; the fake writes to
    // STORAGE_LOCAL_DIR and serves HMAC-signed links from this API.
    STORAGE_PROVIDER: z.enum(['fake']).default('fake'),
    STORAGE_LOCAL_DIR: z.string().default('.data/media'),
    // Base URL clients use to reach this API (signed links point here when storage is fake).
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  })
  // 'fake' is the only provider today, so lint calls the second check redundant. It is the guard
  // that keeps production from booting with the fake once a real provider is added.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  .refine((e) => !(e.NODE_ENV === 'production' && e.SMS_PROVIDER === 'fake'), {
    path: ['SMS_PROVIDER'],
    message: 'the fake SMS provider prints OTPs to the log and must never run in production',
  })
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  .refine((e) => !(e.NODE_ENV === 'production' && e.STORAGE_PROVIDER === 'fake'), {
    path: ['STORAGE_PROVIDER'],
    message: 'the fake storage keeps KYC files on local disk and must never run in production',
  });

export type Env = z.infer<typeof envSchema>;

/** Validates env vars, reporting every problem at once so a broken deploy is fixed in one go. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}

// Repo-root .env for local dev. Variables already set in the real environment win.
const dotEnvPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(dotEnvPath)) process.loadEnvFile(dotEnvPath);

/** Validated at import time, so the process fails at boot rather than on first use. */
export const env = loadEnv(process.env);
