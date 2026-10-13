import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Transactional outbox: written in the same transaction as the state change it describes,
 * then published to the queue by the relay in apps/jobs. Platform infrastructure, so no city_id.
 */
export const outboxEvent = pgTable(
  'outbox_event',
  {
    id: uuid().primaryKey().defaultRandom(), // also the event id consumers deduplicate on
    type: text().notNull(), // e.g. 'user.created'
    aggregateType: text().notNull(),
    aggregateId: uuid().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true }),
  },
  // Partial index: the relay only ever scans unpublished rows.
  (t) => [
    index('outbox_event_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

/** Events a consumer has already handled, so a redelivered event is applied once. */
export const processedEvent = pgTable(
  'processed_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    consumer: text().notNull(),
    eventId: uuid().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('processed_event_consumer_event_id_unique').on(t.consumer, t.eventId)],
);
