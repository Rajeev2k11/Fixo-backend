import { z } from 'zod';

// Admin panel requests (spec §Y). All /v1/admin/* routes need an admin access token.

export const adminRoleCodeSchema = z.enum([
  'super_admin',
  'operations',
  'verification',
  'finance',
  'support',
]);
export type AdminRoleCode = z.infer<typeof adminRoleCodeSchema>;

/** Every admin change to money, rules, KYC or accounts carries a reason (audit, spec §Y). */
const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

export const configScopeSchema = z.strictObject({
  cityId: z.uuid().optional(),
  zoneId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  subcategoryId: z.uuid().optional(),
  problemId: z.uuid().optional(),
});

export const proposeConfigSchema = z.strictObject({
  key: z.string().min(1).max(100),
  scope: configScopeSchema.optional(),
  /** Checked against the key's own schema on the server. */
  value: z.unknown(),
  /** ISO time; default now. A past time is moved up to now (no backdating). */
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  reason,
});
export type ProposeConfig = z.infer<typeof proposeConfigSchema>;

export const decideConfigSchema = z.strictObject({ reason });
export type DecideConfig = z.infer<typeof decideConfigSchema>;

export const listConfigQuerySchema = z.strictObject({
  key: z.string().min(1).max(100).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
export type ListConfigQuery = z.infer<typeof listConfigQuerySchema>;

export const configRuleSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  cityId: z.uuid().nullable(),
  zoneId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  subcategoryId: z.uuid().nullable(),
  problemId: z.uuid().nullable(),
  value: z.unknown(),
  version: z.int(),
  status: z.enum(['pending', 'approved', 'rejected']),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
  reason: z.string(),
  createdBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});

export const createAdminSchema = z.strictObject({
  email: z.email(),
  displayName: z.string().trim().min(2).max(100),
  roleCodes: z.array(adminRoleCodeSchema).min(1),
  reason,
});
export type CreateAdmin = z.infer<typeof createAdminSchema>;

export const createAdminResponseSchema = z.strictObject({
  userId: z.uuid(),
  /** Shown once; the new admin enrols MFA at first login. */
  oneTimePassword: z.string(),
});
export type CreateAdminResponse = z.infer<typeof createAdminResponseSchema>;

export const setAdminRolesSchema = z.strictObject({
  roleCodes: z.array(adminRoleCodeSchema).min(1),
  reason,
});
export type SetAdminRoles = z.infer<typeof setAdminRolesSchema>;
