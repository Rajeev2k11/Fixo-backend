import { z } from 'zod';

/**
 * Stable machine-readable error codes. Clients switch on these, never on messages.
 * Codes are only ever added, never renamed or removed.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
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
