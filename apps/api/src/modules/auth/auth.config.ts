import { z } from 'zod';

import { defineConfigKey } from '../config/config.keys.js';

// Launch values are seeded in migration 0012 (decision OTP-1); admins tune them via config.

const limit = z.strictObject({ max: z.int().min(1), windowSeconds: z.int().min(1) });

export const OTP_LENGTH = defineConfigKey('auth.otp.length', z.int().min(4).max(8));
export const OTP_TTL_SECONDS = defineConfigKey('auth.otp.ttl_seconds', z.int().min(30).max(1800));
export const OTP_MAX_ATTEMPTS = defineConfigKey('auth.otp.max_attempts', z.int().min(1).max(10));
export const OTP_LIMIT_PER_PHONE = defineConfigKey('auth.otp.limit_per_phone', limit);
export const OTP_LIMIT_PER_IP = defineConfigKey('auth.otp.limit_per_ip', limit);
export const OTP_LIMIT_PER_DEVICE = defineConfigKey('auth.otp.limit_per_device', limit);
/** First resend waits this long; each further resend in the window waits twice as long. */
export const OTP_RESEND_COOLDOWN_SECONDS = defineConfigKey(
  'auth.otp.resend_cooldown_seconds',
  z.int().min(0),
);
