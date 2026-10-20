// Pure: what may be uploaded, and what a file really is (no framework imports).
import { imageTypeSchema, mediaPurposeSchema } from '@fixo/contracts';

export const IMAGE_TYPES = imageTypeSchema.options;
export type ImageType = (typeof IMAGE_TYPES)[number];
export type MediaPurpose = (typeof mediaPurposeSchema.options)[number];

/** Which app role may upload each purpose, and which file types it accepts. */
export const PURPOSE_RULES: Record<
  MediaPurpose,
  { roles: readonly string[]; types: readonly ImageType[] }
> = {
  profile_photo: { roles: ['customer', 'worker'], types: IMAGE_TYPES },
  kyc_selfie: { roles: ['worker'], types: IMAGE_TYPES },
  // Decision KYC-3: photos of the Aadhaar card, reviewed manually until a KYC provider is added.
  aadhaar_front: { roles: ['worker'], types: IMAGE_TYPES },
  aadhaar_back: { roles: ['worker'], types: IMAGE_TYPES },
};

/** Bytes to read from the start of a file to identify it. */
export const SNIFF_BYTES = 4096;

/**
 * The type the file's own bytes say it is (its "magic number"), ignoring what the client
 * declared. Null for anything that is not one of the accepted image formats.
 */
export function sniffImageType(start: Buffer): ImageType | null {
  if (start.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (start.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (start.toString('latin1', 0, 4) === 'RIFF' && start.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
