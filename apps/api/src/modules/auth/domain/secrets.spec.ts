import { describe, expect, it } from 'vitest';

import { decrypt, encrypt, hashPassword, verifyPassword } from './secrets.js';

describe('password hashing (scrypt)', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');

    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  const key = 'ab'.repeat(32);

  it('round-trips and refuses a tampered ciphertext or wrong key', () => {
    const sealed = encrypt('JBSWY3DPEHPK3PXP', key);

    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(sealed, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decrypt(`${sealed.slice(0, -2)}xx`, key)).toThrow();
    expect(() => decrypt(sealed, 'cd'.repeat(32))).toThrow();
  });
});
