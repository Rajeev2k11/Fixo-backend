import { z } from 'zod';

// Private uploads (spec §T): request a signed upload URL, PUT the file there, then complete.

export const imageTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const mediaPurposeSchema = z.enum([
  'profile_photo',
  'kyc_selfie',
  'aadhaar_front',
  'aadhaar_back',
]);

export const mediaUploadRequestSchema = z.strictObject({
  purpose: mediaPurposeSchema,
  contentType: imageTypeSchema,
  /** Exact size of the file to upload; the upload URL refuses anything larger. */
  sizeBytes: z.int().min(1),
});
export type MediaUploadRequest = z.infer<typeof mediaUploadRequestSchema>;

export const mediaUploadResponseSchema = z.strictObject({
  mediaId: z.uuid(),
  /** PUT the raw file bytes here with the Content-Type you declared. Short-lived. */
  uploadUrl: z.string(),
  expiresAt: z.iso.datetime(),
});
export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;

export const mediaSchema = z.strictObject({
  id: z.uuid(),
  purpose: mediaPurposeSchema,
  status: z.enum(['pending', 'ready', 'rejected']),
  contentType: imageTypeSchema,
  sizeBytes: z.int().nullable(),
  /** Short-lived link, only when the file is ready. Never store it; ask again when needed. */
  downloadUrl: z.string().nullable(),
  downloadUrlExpiresAt: z.iso.datetime().nullable(),
});
export type Media = z.infer<typeof mediaSchema>;
