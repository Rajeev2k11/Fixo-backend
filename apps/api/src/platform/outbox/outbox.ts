import type { Tx } from '../../common/db.js';
import { outboxEvent, processedEvent } from './outbox.schema.js';

export interface NewOutboxEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Records a domain event in the caller's transaction (CLAUDE.md rule 4). If the transaction
 * rolls back, the event never existed; if it commits, the relay will publish it.
 * Returns the event id.
 */
export async function appendOutbox(tx: Tx, event: NewOutboxEvent): Promise<string> {
  const [row] = await tx.insert(outboxEvent).values(event).returning({ id: outboxEvent.id });
  if (!row) throw new Error('outbox insert returned no row');
  return row.id;
}

/**
 * Claims an event for a consumer. Returns true the first time, false on any redelivery, so the
 * consumer can skip work it already did. Call it in the same transaction as the consumer's writes.
 */
export async function markProcessed(tx: Tx, consumer: string, eventId: string): Promise<boolean> {
  const inserted = await tx
    .insert(processedEvent)
    .values({ consumer, eventId })
    .onConflictDoNothing()
    .returning({ id: processedEvent.id });
  return inserted.length === 1;
}
