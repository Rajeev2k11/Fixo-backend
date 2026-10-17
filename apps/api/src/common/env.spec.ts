import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OTP_HMAC_SECRET: 'x'.repeat(32),
  JWT_SECRET: 'y'.repeat(32),
  MFA_ENCRYPTION_KEY: 'f'.repeat(64),
};

describe('loadEnv', () => {
  it('applies defaults and coerces the port to a number', () => {
    expect(loadEnv({ ...required, API_PORT: '4000' })).toEqual({
      ...required,
      NODE_ENV: 'development',
      API_PORT: 4000,
      REDIS_KEY_PREFIX: 'fixo',
      LOG_LEVEL: 'info',
      SMS_PROVIDER: 'fake',
      STORAGE_PROVIDER: 'fake',
      STORAGE_LOCAL_DIR: '.data/media',
      PUBLIC_BASE_URL: 'http://localhost:3000',
    });
  });

  it('requires the secrets (no defaults for them)', () => {
    expect(() => loadEnv({})).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*OTP_HMAC_SECRET[\s\S]*JWT_SECRET[\s\S]*MFA_ENCRYPTION_KEY/,
    );
  });

  it('rejects a short OTP secret', () => {
    expect(() => loadEnv({ ...required, OTP_HMAC_SECRET: 'short' })).toThrow(/OTP_HMAC_SECRET/);
  });

  it('refuses the fake SMS and storage providers in production', () => {
    expect(() => loadEnv({ ...required, NODE_ENV: 'production' })).toThrow(
      /SMS_PROVIDER[\s\S]*STORAGE_PROVIDER/,
    );
  });

  it('reports every invalid variable in one error', () => {
    expect(() => loadEnv({ ...required, API_PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(
      /Invalid environment variables:[\s\S]*API_PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
