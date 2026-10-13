import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and coerces the port to a number', () => {
    expect(loadEnv({ API_PORT: '4000' })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
    });
  });

  it('reports every invalid variable in one error', () => {
    expect(() => loadEnv({ API_PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(
      /Invalid environment variables:[\s\S]*API_PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
