import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { user } from '../users/users.schema.js';

/**
 * An uploaded file in private storage. The object key is random (purpose/uuid), so a location
 * cannot be guessed; only signed, short-lived links reach the bytes. Belongs to a user, so its
 * city is the owner's (no city_id of its own).
 */
export const media = pgTable(
  'media',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerUserId: uuid()
      .notNull()
      .references(() => user.id),
    purpose: text({
      enum: ['profile_photo', 'kyc_selfie', 'aadhaar_front', 'aadhaar_back'],
    }).notNull(),
    status: text({ enum: ['pending', 'ready', 'rejected'] })
      .notNull()
      .default('pending'),
    contentType: text({ enum: ['image/jpeg', 'image/png', 'image/webp'] }).notNull(),
    declaredBytes: integer().notNull(),
    sizeBytes: integer(), // measured on completion
    objectKey: text().notNull().unique(),
    rejectReason: text(),
    uploadExpiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'media_purpose_check',
      sql`${t.purpose} in ('profile_photo', 'kyc_selfie', 'aadhaar_front', 'aadhaar_back')`,
    ),
    check('media_status_check', sql`${t.status} in ('pending', 'ready', 'rejected')`),
    index('media_owner_idx').on(t.ownerUserId),
  ],
);

export type MediaRow = typeof media.$inferSelect;
