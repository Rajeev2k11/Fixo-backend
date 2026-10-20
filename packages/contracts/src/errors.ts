import { z } from 'zod';

/**
 * Stable machine-readable error codes. Clients switch on these, never on messages.
 * Codes are only ever added, never renamed or removed.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  /** Missing, invalid or expired access token: refresh it (or log in). */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_MISMATCH: 'IDEMPOTENCY_KEY_MISMATCH',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  CONFIG_KEY_UNKNOWN: 'CONFIG_KEY_UNKNOWN',
  CONFIG_NOT_SET: 'CONFIG_NOT_SET',
  CONFIG_OVERLAP: 'CONFIG_OVERLAP',
  CONFIG_NOT_PENDING: 'CONFIG_NOT_PENDING',
  MAKER_CANNOT_APPROVE: 'MAKER_CANNOT_APPROVE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  RATE_LIMITED: 'RATE_LIMITED',
  OTP_INVALID: 'OTP_INVALID',
  /** Refresh was refused (expired, revoked, reused or wrong device): log in again with OTP. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** The account is suspended or blocked. */
  ACCOUNT_RESTRICTED: 'ACCOUNT_RESTRICTED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  MFA_INVALID: 'MFA_INVALID',
  CSRF_FAILED: 'CSRF_FAILED',
  /** The uploaded file was refused (wrong type, too large, or failed the malware scan). */
  MEDIA_REJECTED: 'MEDIA_REJECTED',
  MEDIA_NOT_UPLOADED: 'MEDIA_NOT_UPLOADED',
  /** The worker has submitted for review; the profile cannot change until sent back. */
  PROFILE_LOCKED: 'PROFILE_LOCKED',
  /** A newer agreement version exists: show it and accept that one. */
  AGREEMENT_OUTDATED: 'AGREEMENT_OUTDATED',
  AGREEMENT_NOT_PUBLISHED: 'AGREEMENT_NOT_PUBLISHED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The one error shape every API response uses. `code` is a plain string so old clients survive new codes. */
export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.unknown(),
    requestId: z.string(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;
