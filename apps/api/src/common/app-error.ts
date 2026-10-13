import type { ErrorCode } from '@fixo/contracts';

/** Throw this for any expected failure; the exception filter turns it into the standard error body. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}
