import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { user } from '../users/users.schema.js';

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

/**
 * A login on one device (a refresh-token family). Revoking it ends every token issued in it.
 * Auth infrastructure, so no city_id.
 */
export const session = pgTable(
  'session',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    deviceInstallId: uuid().notNull(), // X-Device-Id: refresh only works from this install
    activeRole: text({ enum: ['customer', 'worker', 'admin'] }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp({ withTimezone: true }).notNull(), // pushed forward by each refresh
    absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokeReason: text(),
  },
  (t) => [
    check('session_active_role_check', sql`${t.activeRole} in ('customer', 'worker', 'admin')`),
    index('session_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** One refresh token. Only its SHA-256 is stored; used_at marks it spent (rotation). */
export const refreshToken = pgTable('refresh_token', {
  id: uuid().primaryKey().defaultRandom(),
  sessionId: uuid()
    .notNull()
    .references(() => session.id),
  tokenHash: text().notNull().unique(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp({ withTimezone: true }),
});

export type SessionRow = typeof session.$inferSelect;

/**
 * An admin's password and MFA (spec §M). The TOTP secret is encrypted at rest (AES-256-GCM).
 * Auth infrastructure, so no city_id.
 */
export const adminCredential = pgTable('admin_credential', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id),
  passwordHash: text().notNull(),
  totpSecretEncrypted: text(), // set at enrolment start; confirmed by mfa_enrolled_at
  mfaEnrolledAt: timestamp({ withTimezone: true }),
  lastTotpStep: integer(), // a code's time step is accepted once, so codes cannot be replayed
  failedPasswordAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type AdminCredentialRow = typeof adminCredential.$inferSelect;
