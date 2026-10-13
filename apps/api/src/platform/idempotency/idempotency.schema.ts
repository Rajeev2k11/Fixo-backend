import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** Remembered results of Idempotency-Key requests (CLAUDE.md rule 5). Platform infrastructure, so no city_id. */
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    id: uuid().primaryKey().defaultRandom(),
    scope: text().notNull(), // who + which route, so two clients can't collide on one key
    key: text().notNull(),
    requestHash: text().notNull(),
    status: text({ enum: ['in_progress', 'completed'] }).notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_key_scope_key_unique').on(t.scope, t.key),
    check('idempotency_key_status_check', sql`${t.status} in ('in_progress', 'completed')`),
  ],
);
