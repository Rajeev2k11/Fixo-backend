import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode, matchTotp, totpAt } from './totp.js';

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890". The RFC lists 8-digit codes;
// 6-digit codes are their last six digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238 test vectors)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i -> %s', (unixSeconds, expected) => {
    const step = Math.floor(unixSeconds / 30);
    expect(totpAt(RFC_SECRET, step, 8)).toBe(expected);
    expect(totpAt(RFC_SECRET, step)).toBe(expected.slice(-6));
  });

  it('accepts one step of clock drift either side, and no more', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), now)).toBeNull();
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
});
