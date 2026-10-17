import { z } from 'zod';

import { defineConfigKey } from '../config/config.keys.js';

// Launch values are seeded in migrations (OTP-1: 0012, AUTH-1: 0014, AUTH-2: 0016); admins tune them via config.

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

export const ACCESS_TOKEN_TTL_SECONDS = defineConfigKey(
  'auth.access_token_ttl_seconds',
  z.int().min(60).max(3600),
);
/** A session unused for this long must log in again (each refresh extends it). */
export const SESSION_IDLE_DAYS = defineConfigKey('auth.session.idle_days', z.int().min(1));
/** A session ends this long after login, however active. */
export const SESSION_MAX_DAYS = defineConfigKey('auth.session.max_days', z.int().min(1));

// Admin login (decision AUTH-2).
export const ADMIN_SESSION_IDLE_MINUTES = defineConfigKey(
  'auth.admin.session_idle_minutes',
  z.int().min(5),
);
export const ADMIN_SESSION_MAX_HOURS = defineConfigKey(
  'auth.admin.session_max_hours',
  z.int().min(1),
);
export const ADMIN_PASSWORD_MIN_LENGTH = defineConfigKey(
  'auth.admin.password_min_length',
  z.int().min(8),
);
export const ADMIN_MAX_PASSWORD_FAILURES = defineConfigKey(
  'auth.admin.max_password_failures',
  z.int().min(1),
);
export const ADMIN_LOCKOUT_MINUTES = defineConfigKey('auth.admin.lockout_minutes', z.int().min(1));
export const ADMIN_MFA_MAX_ATTEMPTS = defineConfigKey(
  'auth.admin.mfa_max_attempts',
  z.int().min(1),
);
