import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { city } from '../geo/geo.schema.js';
import { WORKER_STATUSES } from './domain/worker.state-machine.js';

// Identity (spec §K, decision SPEC-3): one user, many linked auth identities and role profiles.

export const user = pgTable(
  'user',
  {
    id: uuid().primaryKey().defaultRandom(),
    status: text({ enum: ['active', 'suspended', 'blocked'] })
      .notNull()
      .default('active'),
    version: integer().notNull().default(1), // compare-and-set for status changes
    cityId: uuid().references(() => city.id), // home city; null until known (admins: none)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('user_status_check', sql`${t.status} in ('active', 'suspended', 'blocked')`)],
);

/** A way to log in: a phone (OTP) or an email (password + MFA, admins). Values are normalised. */
export const authIdentity = pgTable(
  'auth_identity',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    type: text({ enum: ['phone', 'email'] }).notNull(),
    value: text().notNull(), // E.164 phone or lower-case email
    verifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('auth_identity_type_value_unique').on(t.type, t.value),
    check('auth_identity_type_check', sql`${t.type} in ('phone', 'email')`),
  ],
);

export const customerProfile = pgTable('customer_profile', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id),
  name: text(), // the only required profile field, asked at first booking (spec §B.6)
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * A worker's identity profile and onboarding status (decision WORKER-1). Status changes only
 * through WorkerProfileService.transition() (compare-and-set on version, history, event).
 * Areas, services and availability belong to the workers module (Phase 3).
 */
export const workerProfile = pgTable(
  'worker_profile',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => user.id),
    name: text(),
    // A ready profile_photo owned by this user (checked by the service; no FK, to keep the
    // users and media schemas from importing each other).
    photoMediaId: uuid(),
    status: text({ enum: WORKER_STATUSES }).notNull().default('registered'),
    version: integer().notNull().default(1),
    statusReason: text(), // why it was rejected or sent back for resubmission, shown to the worker
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'worker_profile_status_check',
      sql`${t.status} in ('registered', 'kyc_pending', 'under_review', 'verified', 'rejected', 'suspended')`,
    ),
    // The admin verification queue reads open statuses only.
    index('worker_profile_review_idx')
      .on(t.status, t.updatedAt)
      .where(sql`${t.status} in ('kyc_pending', 'under_review')`),
  ],
);

export const workerStatusHistory = pgTable('worker_status_history', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => user.id),
  fromStatus: text().notNull(),
  toStatus: text().notNull(),
  actorUserId: uuid().references(() => user.id), // null: the system (e.g. KYC expiry)
  reason: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Every agreement version a worker accepted, and when (spec §C.6). Append-only by use. */
export const workerAgreementAcceptance = pgTable(
  'worker_agreement_acceptance',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    version: text().notNull(),
    acceptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('worker_agreement_acceptance_user_version_unique').on(t.userId, t.version)],
);

export const adminProfile = pgTable('admin_profile', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id),
  displayName: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Admin roles (spec §D, §Y). Seeded in migration; permissions per role arrive in step 1.12. */
export const adminRole = pgTable('admin_role', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(), // 'super_admin', 'operations', 'verification', 'finance', 'support'
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const userAdminRole = pgTable(
  'user_admin_role',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    adminRoleId: uuid()
      .notNull()
      .references(() => adminRole.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_admin_role_user_id_admin_role_id_unique').on(t.userId, t.adminRoleId)],
);

export const userStatusHistory = pgTable('user_status_history', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => user.id),
  fromStatus: text(), // null for the initial status at creation
  toStatus: text().notNull(),
  actorUserId: uuid(), // null when the user themself caused it (sign-up)
  reason: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof user.$inferSelect;
export type WorkerProfileRow = typeof workerProfile.$inferSelect;
