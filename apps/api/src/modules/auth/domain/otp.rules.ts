import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

// Pure: no framework imports (CLAUDE.md folder layout).

/** A uniformly random numeric code, e.g. "042917" for length 6. */
export function generateCode(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

/** Cooldown before the next resend: base, then 2x, 4x... for the nth send in the window. */
export function resendCooldown(baseSeconds: number, sendsInWindow: number): number {
  return baseSeconds * 2 ** Math.max(0, sendsInWindow - 1);
}

/**
 * Keyed hash, so a leaked table cannot be brute-forced offline (a 6-digit code or a 10-digit
 * phone number is trivial to enumerate under a plain hash).
 */
export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
