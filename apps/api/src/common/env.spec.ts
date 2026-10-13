import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and coerces the port to a number', () => {
    const DATABASE_URL = 'postgres://u:p@localhost:5432/db';
    const REDIS_URL = 'redis://localhost:6379';

    expect(loadEnv({ API_PORT: '4000', DATABASE_URL, REDIS_URL })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      DATABASE_URL,
      REDIS_URL,
      LOG_LEVEL: 'info',
    });
  });

  it('requires DATABASE_URL and REDIS_URL (they can hold secrets, so no defaults)', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('reports every invalid variable in one error', () => {
    expect(() => loadEnv({ API_PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(
      /Invalid environment variables:[\s\S]*API_PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
