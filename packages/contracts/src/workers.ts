import { z } from 'zod';

// Worker app onboarding (spec §C). The app collects every step locally and sends it in one
// submission; files (photo, Aadhaar, selfie) are uploaded first through /media.

export const workerStatusSchema = z.enum([
  'registered',
  'kyc_pending',
  'under_review',
  'verified',
  'rejected',
  'suspended',
]);
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

export const weekdaySchema = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');

export const availabilitySchema = z
  .strictObject({
    days: z
      .array(weekdaySchema)
      .min(1, 'Pick at least one working day')
      .refine((d) => new Set(d).size === d.length, 'Days must not repeat'),
    allDay: z.boolean(),
    startTime: time,
    endTime: time,
    emergency: z.boolean(),
  })
  .refine((a) => a.allDay || a.endTime > a.startTime, {
    path: ['endTime'],
    message: 'End time must be after start time',
  });
export type Availability = z.infer<typeof availabilitySchema>;

const uuidList = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Ids must not repeat');

/** Everything the 7 onboarding steps collect, sent once when the worker taps Submit. */
export const workerOnboardingSchema = z
  .strictObject({
    // 1. Basic profile
    name: z.string().trim().min(2).max(80),
    /** A ready profile_photo upload of yours. */
    photoMediaId: z.uuid(),
    cityId: z.uuid(),
    // 2. Areas
    wholeCity: z.boolean(),
    areaIds: uuidList(100),
    // 3. Services
    categoryIds: uuidList(30).min(1, 'Pick at least one service'),
    // 4. Experience
    experienceYears: z.int().min(0).max(50),
    about: z.string().trim().max(500).optional(),
    // 5. KYC (decision KYC-3): ready uploads of yours with these purposes
    kyc: z.strictObject({
      aadhaarFrontMediaId: z.uuid(),
      aadhaarBackMediaId: z.uuid(),
      selfieMediaId: z.uuid(),
    }),
    // 7. Availability (step 6, bank/UPI, waits for payouts: decision BANK-1)
    availability: availabilitySchema,
    // 8. Agreement: the version the app showed (from GET /workers/me agreement.currentVersion)
    agreementVersion: z.string().min(1).max(50),
  })
  .refine((v) => v.wholeCity || v.areaIds.length > 0, {
    path: ['areaIds'],
    message: 'Pick at least one area, or the whole city',
  });
export type WorkerOnboarding = z.infer<typeof workerOnboardingSchema>;

export const workerProfileSchema = z.strictObject({
  userId: z.uuid(),
  status: workerStatusSchema,
  /** Why the application was rejected or sent back, when it was. */
  statusReason: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  agreement: z.strictObject({
    acceptedVersion: z.string().nullable(),
    /** The version to show and accept; null until one is published. */
    currentVersion: z.string().nullable(),
  }),
  /** What was last submitted (to prefill a resubmission); empty before the first submit. */
  onboarding: z.strictObject({
    name: z.string().nullable(),
    photo: z.strictObject({ mediaId: z.uuid(), url: z.string().nullable() }).nullable(),
    cityId: z.uuid().nullable(),
    wholeCity: z.boolean(),
    areaIds: z.array(z.uuid()),
    categoryIds: z.array(z.uuid()),
    experienceYears: z.int().nullable(),
    about: z.string().nullable(),
    availability: availabilitySchema.nullable(),
    /** KYC files are never returned to the app; only whether they were submitted. */
    kycSubmitted: z.boolean(),
  }),
});
export type WorkerProfile = z.infer<typeof workerProfileSchema>;
