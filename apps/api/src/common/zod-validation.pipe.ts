import { PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@fixo/contracts';
import type { z } from 'zod';

import { AppError } from './app-error.js';

/**
 * Usage: `@Body(new ZodValidationPipe(schema))`. Request schemas must be `z.strictObject`
 * so unknown fields (e.g. a client-sent price or role) are rejected, not silently dropped.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Request validation failed',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
