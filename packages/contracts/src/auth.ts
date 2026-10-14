import { z } from 'zod';

import { indianMobileSchema } from './phone.js';

export const otpRequestSchema = z.strictObject({ phone: indianMobileSchema });
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.strictObject({
  expiresInSeconds: z.int(),
  /** When the app may offer "resend". */
  resendAfterSeconds: z.int(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const otpVerifySchema = z.strictObject({
  phone: indianMobileSchema,
  code: z.string().regex(/^\d{4,8}$/, 'Enter the code from the SMS'),
  /** Which app is logging in; the account gets that profile if it lacks it. */
  role: z.enum(['customer', 'worker']),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/** Step 1.10 adds the access and refresh tokens to this response. */
export const otpVerifyResponseSchema = z.strictObject({
  userId: z.uuid(),
  roles: z.array(z.enum(['customer', 'worker', 'admin'])),
  isNew: z.boolean(),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;
