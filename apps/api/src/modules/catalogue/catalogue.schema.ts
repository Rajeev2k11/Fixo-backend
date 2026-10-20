import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Top level of the service catalogue (spec §K: Category -> Subcategory -> Problem). Admin-managed
 * reference data, nothing seeded until the owner provides the real list (decision REF-1).
 * Subcategories, problems and pricing guidelines arrive in Phase 3.
 */
export const serviceCategory = pgTable('service_category', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
