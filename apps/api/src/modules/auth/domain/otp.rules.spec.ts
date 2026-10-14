import { describe, expect, it } from 'vitest';

import { generateCode, hashesEqual, hmac, resendCooldown } from './otp.rules.js';

describe('generateCode', () => {
  it('returns exactly `length` digits, keeping leading zeros', () => {
    for (let i = 0; i < 200; i++) expect(generateCode(6)).toMatch(/^\d{6}$/);
  });
});

describe('resendCooldown', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
  ])('send #%i waits %is', (n, seconds) => {
    expect(resendCooldown(30, n)).toBe(seconds);
  });

  it('is zero when the base is zero', () => {
    expect(resendCooldown(0, 5)).toBe(0);
  });
});

describe('hmac', () => {
  it('depends on the secret, so a leaked hash is useless without it', () => {
    expect(hmac('secret-a', '123456')).not.toBe(hmac('secret-b', '123456'));
    expect(hashesEqual(hmac('s', '123456'), hmac('s', '123456'))).toBe(true);
    expect(hashesEqual(hmac('s', '123456'), hmac('s', '123457'))).toBe(false);
  });
});
