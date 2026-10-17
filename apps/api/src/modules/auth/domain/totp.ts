import { createHmac, randomBytes } from 'node:crypto';

// RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits): what Google Authenticator and friends use.
// Pure: no framework imports.

const STEP_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5)
    out += ALPHABET.charAt(parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2));
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = '';
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('invalid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** A new 160-bit secret, base32 as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const timeStep = (unixMs: number): number => Math.floor(unixMs / 1000 / STEP_SECONDS);

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 0x0f;
  const binary = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The matching time step, or null. Accepts one step either side for phone clock drift.
 * Callers must reject steps at or before the last one used, so a code cannot be replayed.
 */
export function matchTotp(secret: string, code: string, unixMs: number): number | null {
  const now = timeStep(unixMs);
  for (const step of [now, now - 1, now + 1]) if (totpAt(secret, step) === code) return step;
  return null;
}

export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
