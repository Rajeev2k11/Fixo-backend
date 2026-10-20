import { z } from 'zod';

// Worker app onboarding (spec §C, decision PHASE-1: areas and services follow in Phase 3).

export const workerStatusSchema = z.enum([
  'registered',
  'kyc_pending',
  'under_review',
  'verified',
  'rejected',
  'suspended',
]);
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

/** Onboarding items still to do before the worker can submit for review. */
export const onboardingItemSchema = z.enum(['name', 'photo', 'city', 'agreement']);

export const workerProfileSchema = z.strictObject({
  userId: z.uuid(),
  status: workerStatusSchema,
  /** Why the application was rejected or sent back, when it was. */
  statusReason: z.string().nullable(),
  name: z.string().nullable(),
  photo: z.strictObject({ mediaId: z.uuid(), url: z.string().nullable() }).nullable(),
  cityId: z.uuid().nullable(),
  agreement: z.strictObject({
    acceptedVersion: z.string().nullable(),
    acceptedAt: z.iso.datetime().nullable(),
    /** The version to show and accept; null until one is published. */
    currentVersion: z.string().nullable(),
  }),
  missing: z.array(onboardingItemSchema),
});
export type WorkerProfile = z.infer<typeof workerProfileSchema>;

export const updateWorkerProfileSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80).optional(),
    /** A ready profile_photo upload of yours (see /media). */
    photoMediaId: z.uuid().optional(),
    cityId: z.uuid().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field');
export type UpdateWorkerProfile = z.infer<typeof updateWorkerProfileSchema>;

export const acceptAgreementSchema = z.strictObject({ version: z.string().min(1).max(50) });
export type AcceptAgreement = z.infer<typeof acceptAgreementSchema>;
