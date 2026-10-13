import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Append-only record of admin actions on money, rules, KYC or account status (spec §T, §Y).
 * A trigger (migration 0005) rejects UPDATE, DELETE and TRUNCATE. Platform table, so no city_id.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid().notNull(), // FK to user added when the user table exists (step 1.8)
    actorRole: text().notNull(), // e.g. 'super_admin', 'finance'
    action: text().notNull(), // e.g. 'config.rule.approved'
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text().notNull(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_log_reason_check', sql`length(trim(${t.reason})) > 0`),
    // "What happened to this record?" is the main question admins ask of the log.
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  ],
);
