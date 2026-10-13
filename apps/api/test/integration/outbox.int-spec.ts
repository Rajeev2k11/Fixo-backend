import { randomUUID } from 'node:crypto';

import { eventEnvelopeSchema } from '@fixo/contracts';
import { Queue } from 'bullmq';
import { count, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  appendOutbox,
  markProcessed,
  type NewOutboxEvent,
} from '../../src/platform/outbox/outbox.js';
import { type EventQueue, OutboxRelay } from '../../src/platform/outbox/outbox-relay.js';
import { outboxEvent } from '../../src/platform/outbox/outbox.schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });

afterAll(() => pool.end());
beforeEach(() => db.execute(sql`truncate outbox_event, processed_event`));

function newEvent(): NewOutboxEvent {
  return {
    type: 'test.happened',
    aggregateType: 'test',
    aggregateId: randomUUID(),
    payload: { n: 1 },
  };
}

async function unpublished(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(outboxEvent)
    .where(isNull(outboxEvent.publishedAt));
  return row?.n ?? 0;
}

/** Records every job it is given, including duplicates BullMQ itself would silently drop. */
class RecordingQueue implements EventQueue {
  readonly jobIds: string[] = [];
  addBulk(jobs: Parameters<EventQueue['addBulk']>[0]): Promise<void> {
    this.jobIds.push(...jobs.map((j) => j.opts.jobId));
    return Promise.resolve();
  }
}

describe('appendOutbox', () => {
  it('commits the event together with the transaction', async () => {
    await db.transaction((tx) => appendOutbox(tx, newEvent()));

    expect(await unpublished()).toBe(1);
  });

  it('leaves no event when the transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await appendOutbox(tx, newEvent());
        throw new Error('state change failed');
      }),
    ).rejects.toThrow('state change failed');

    expect(await unpublished()).toBe(0);
  });
});

describe('OutboxRelay', () => {
  it('two relays running concurrently publish every event exactly once', async () => {
    const ids = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 50; i++) out.push(await appendOutbox(tx, newEvent()));
      return out;
    });
    const queueA = new RecordingQueue();
    const queueB = new RecordingQueue();
    const relayA = new OutboxRelay(db, queueA);
    const relayB = new OutboxRelay(db, queueB);

    for (;;) {
      const [a, b] = await Promise.all([relayA.relayBatch(7), relayB.relayBatch(7)]);
      if (a + b === 0) break;
    }

    const published = [...queueA.jobIds, ...queueB.jobIds];
    expect(published.toSorted()).toEqual(ids.toSorted());
    expect(queueA.jobIds.length).toBeGreaterThan(0);
    expect(queueB.jobIds.length).toBeGreaterThan(0);
    expect(await unpublished()).toBe(0);
  });

  it('keeps events unpublished when the queue is down, so they are retried', async () => {
    await db.transaction((tx) => appendOutbox(tx, newEvent()));
    const downQueue: EventQueue = { addBulk: () => Promise.reject(new Error('redis down')) };

    await expect(new OutboxRelay(db, downQueue).relayBatch()).rejects.toThrow('redis down');

    expect(await unpublished()).toBe(1);
  });

  it('delivers the event envelope to a real BullMQ queue', async () => {
    const connection = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
    const queue = new Queue(`test-${randomUUID()}`, { connection });
    try {
      const event = newEvent();
      const id = await db.transaction((tx) => appendOutbox(tx, event));

      await new OutboxRelay(db, queue).relayBatch();

      const job = await queue.getJob(id);
      expect(job?.name).toBe('test.happened');
      expect(eventEnvelopeSchema.parse(job?.data)).toMatchObject({ id, ...event });
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  });
});

describe('markProcessed', () => {
  it('lets a consumer apply an event once, however often it is delivered', async () => {
    const eventId = randomUUID();

    const first = await db.transaction((tx) => markProcessed(tx, 'test-consumer', eventId));
    const again = await db.transaction((tx) => markProcessed(tx, 'test-consumer', eventId));
    const otherConsumer = await db.transaction((tx) =>
      markProcessed(tx, 'other-consumer', eventId),
    );

    expect([first, again, otherConsumer]).toEqual([true, false, true]);
  });
});
