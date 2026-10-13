import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
