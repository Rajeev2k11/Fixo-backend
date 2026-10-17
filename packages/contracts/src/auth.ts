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

export const appRoleSchema = z.enum(['customer', 'worker', 'admin']);

/** Issued at login and on every refresh. Store the refresh token in secure device storage. */
export const tokenPairSchema = z.strictObject({
  accessToken: z.string(),
  /** Seconds until the access token expires; refresh shortly before. */
  accessTokenExpiresIn: z.int(),
  /** Single use: each refresh returns a new one. Refresh calls must not run in parallel. */
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const otpVerifyResponseSchema = z.strictObject({
  userId: z.uuid(),
  roles: z.array(appRoleSchema),
  /** The role this session acts as (the app that logged in). */
  activeRole: appRoleSchema,
  isNew: z.boolean(),
  tokens: tokenPairSchema,
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

const refreshTokenField = z.string().min(20).max(200);

export const refreshRequestSchema = z.strictObject({ refreshToken: refreshTokenField });
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.strictObject({ refreshToken: refreshTokenField });
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

// Admin web login (spec §M): email + password, then a TOTP code. MFA is mandatory.

export const adminLoginSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1).max(200),
});
export type AdminLogin = z.infer<typeof adminLoginSchema>;

export const adminLoginResponseSchema = z.discriminatedUnion('stage', [
  /** First login: add this secret to an authenticator app, then send a code to /mfa. */
  z.strictObject({
    stage: z.literal('enroll'),
    mfaToken: z.string(),
    otpauthUrl: z.string(),
    secret: z.string(),
  }),
  z.strictObject({ stage: z.literal('verify'), mfaToken: z.string() }),
]);
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

export const adminMfaSchema = z.strictObject({
  mfaToken: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
export type AdminMfa = z.infer<typeof adminMfaSchema>;

/** The refresh token is not in the body: it is set as an httpOnly cookie. */
export const adminAccessResponseSchema = z.strictObject({
  accessToken: z.string(),
  accessTokenExpiresIn: z.int(),
});
export type AdminAccessResponse = z.infer<typeof adminAccessResponseSchema>;

export const adminSessionResponseSchema = adminAccessResponseSchema.extend({
  userId: z.uuid(),
  adminRoles: z.array(z.string()),
});
export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;
