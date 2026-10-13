import {
  boolean,
  char,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Geography is reference data (spec §A: Country → State → City → Area → Zone).
// Areas and zones, with PostGIS polygons, arrive in Phase 3. That migration must start with
// `CREATE EXTENSION IF NOT EXISTS postgis`: the docker image pre-installs PostGIS only in the
// default database, not in fresh test databases, so relying on the image causes env drift.

export const country = pgTable('country', {
  id: uuid().primaryKey().defaultRandom(),
  code: char({ length: 2 }).notNull().unique(), // ISO 3166-1 alpha-2
  name: text().notNull(),
  isActive: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const state = pgTable(
  'state',
  {
    id: uuid().primaryKey().defaultRandom(),
    countryId: uuid()
      .notNull()
      .references(() => country.id),
    code: varchar({ length: 8 }).notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('state_country_id_code_unique').on(t.countryId, t.code)],
);

export const city = pgTable('city', {
  id: uuid().primaryKey().defaultRandom(),
  stateId: uuid()
    .notNull()
    .references(() => state.id),
  slug: text().notNull().unique(),
  name: text().notNull(),
  // Activating a city is an admin action, so new rows start inactive.
  isActive: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
