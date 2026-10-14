import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { city } from '../geo/geo.schema.js';
import { user } from '../users/users.schema.js';

/**
 * Every configurable business value (CLAUDE.md rule 7, decision SPEC-4): one row per version
 * of one key in one scope. Rows are never deleted or rewritten; a new version only closes the
 * previous one's effective_to. Migration 0007 adds the no-overlap and unique-version constraints.
 */
export const configRule = pgTable(
  'config_rule',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text().notNull(),
    // Scope: at most one geography column and one catalogue column (null = any).
    cityId: uuid().references(() => city.id),
    zoneId: uuid(), // FK added with the zone table (Phase 3)
    categoryId: uuid(), // FKs added with the catalogue tables (Phase 3)
    subcategoryId: uuid(),
    problemId: uuid(),
    value: jsonb().notNull(),
    version: integer().notNull(),
    status: text({ enum: ['pending', 'approved', 'rejected'] }).notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    effectiveTo: timestamp({ withTimezone: true }),
    reason: text().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => user.id),
    approvedBy: uuid().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('config_rule_status_check', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check('config_rule_reason_check', sql`length(trim(${t.reason})) > 0`),
    check(
      'config_rule_effective_range_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    // SPEC-2 maker-checker, enforced by the database as well as the service.
    check(
      'config_rule_maker_checker_check',
      sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.createdBy}`,
    ),
    check('config_rule_one_geo_scope_check', sql`num_nonnulls(${t.cityId}, ${t.zoneId}) <= 1`),
    check(
      'config_rule_one_catalogue_scope_check',
      sql`num_nonnulls(${t.categoryId}, ${t.subcategoryId}, ${t.problemId}) <= 1`,
    ),
    index('config_rule_key_idx')
      .on(t.key)
      .where(sql`${t.status} = 'approved'`),
  ],
);

export type ConfigRuleRow = typeof configRule.$inferSelect;
