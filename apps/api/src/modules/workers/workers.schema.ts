import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { serviceCategory } from '../catalogue/catalogue.schema.js';
import { area, city } from '../geo/geo.schema.js';
import { user } from '../users/users.schema.js';

// Worker capability (spec §K): what a worker does, where and when. Written as a whole on each
// onboarding submission. Rows reference media by id (KYC-3) without FKs, like worker_profile.

export const workerArea = pgTable(
  'worker_area',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    areaId: uuid()
      .notNull()
      .references(() => area.id),
    cityId: uuid()
      .notNull()
      .references(() => city.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('worker_area_user_id_area_id_unique').on(t.userId, t.areaId)],
);

export const workerService = pgTable(
  'worker_service',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    categoryId: uuid()
      .notNull()
      .references(() => serviceCategory.id),
    cityId: uuid()
      .notNull()
      .references(() => city.id),
    // Skill verification per service (spec §C.7, OBD-12 probation) is decided in Phase 3.
    skillStatus: text({ enum: ['pending', 'probation', 'verified', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('worker_service_user_id_category_id_unique').on(t.userId, t.categoryId),
    check(
      'worker_service_skill_status_check',
      sql`${t.skillStatus} in ('pending', 'probation', 'verified', 'rejected')`,
    ),
  ],
);

/** Coverage and working hours (spec §C onboarding step 3 and the daily loop). One per worker. */
export const workerPreference = pgTable('worker_preference', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id),
  cityId: uuid()
    .notNull()
    .references(() => city.id),
  wholeCity: boolean().notNull(),
  days: text().array().notNull(),
  allDay: boolean().notNull(),
  startTime: text().notNull(), // HH:mm, local (Asia/Kolkata) working hours
  endTime: text().notNull(),
  emergency: boolean().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** The KYC files of the latest submission (decision KYC-3). Reviewed by admins in step 2.5. */
export const workerKyc = pgTable('worker_kyc', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => user.id),
  cityId: uuid()
    .notNull()
    .references(() => city.id),
  aadhaarFrontMediaId: uuid().notNull(),
  aadhaarBackMediaId: uuid().notNull(),
  selfieMediaId: uuid().notNull(),
  submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
