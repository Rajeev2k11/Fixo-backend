import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * One OTP sent to one phone. Only HMACs are stored: neither the code nor the phone number
 * (a challenge exists before any user does). Auth infrastructure, so no city_id.
 */
export const otpChallenge = pgTable(
  'otp_challenge',
  {
    id: uuid().primaryKey().defaultRandom(),
    phoneHash: text().notNull(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }), // used, or superseded by a newer OTP
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Verify only ever looks at a phone's open challenge.
  (t) => [
    index('otp_challenge_open_idx')
      .on(t.phoneHash, t.createdAt)
      .where(sql`${t.consumedAt} is null`),
  ],
);

export type OtpChallengeRow = typeof otpChallenge.$inferSelect;
