import { z } from 'zod';

/**
 * An Indian mobile number in any common written form ("98765 43210", "09876543210",
 * "+91-98765-43210"), normalised to E.164 ("+919876543210"). Shared so app and API agree.
 */
export const indianMobileSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(?:\+91|91|0)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number'))
  .transform((s) => `+91${s.slice(-10)}`);
