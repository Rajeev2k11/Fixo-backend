import { setTimeout as sleep } from 'node:timers/promises';

import type { EventEnvelope } from '@fixo/contracts';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { inArray, isNull, sql } from 'drizzle-orm';

import { DB, type Db } from '../../common/db.js';
import { outboxEvent } from './outbox.schema.js';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const EVENT_QUEUE = Symbol('EVENT_QUEUE');

/** The slice of a BullMQ Queue the relay uses. */
export interface EventQueue {
  addBulk(jobs: { name: string; data: EventEnvelope; opts: { jobId: string } }[]): Promise<unknown>;
}

const BATCH_SIZE = 100;
// ponytail: polling every 500ms when idle; switch to LISTEN/NOTIFY if event latency matters.
const IDLE_POLL_MS = 500;

/**
 * Moves committed outbox rows into the queue. Delivery is at-least-once: a crash between
 * publishing and committing re-publishes the batch, so consumers deduplicate with
 * markProcessed(). The jobId is the event id, which also lets BullMQ drop duplicates it still holds.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;
  private stopped: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EVENT_QUEUE) private readonly queue: EventQueue,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.stopped = this.loop();
  }

  // Stop before the queue and DB pool close (those run in onApplicationShutdown).
  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.stopped;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.relayBatch();
      } catch (err) {
        this.logger.error(err);
      }
      if (published === 0) await sleep(IDLE_POLL_MS);
    }
  }

  /**
   * Publishes one batch and returns how many events it sent. SKIP LOCKED lets several relays
   * run at once: each claims different rows, and none waits on another.
   */
  async relayBatch(limit = BATCH_SIZE): Promise<number> {
    return this.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(outboxEvent)
        .where(isNull(outboxEvent.publishedAt))
        .orderBy(outboxEvent.occurredAt)
        .limit(limit)
        .for('update', { skipLocked: true });
      if (events.length === 0) return 0;

      await this.queue.addBulk(
        events.map((e) => ({
          name: e.type,
          data: {
            id: e.id,
            type: e.type,
            aggregateType: e.aggregateType,
            aggregateId: e.aggregateId,
            occurredAt: e.occurredAt.toISOString(),
            payload: e.payload,
          },
          opts: { jobId: e.id },
        })),
      );

      await tx
        .update(outboxEvent)
        .set({ publishedAt: sql`now()` })
        .where(
          inArray(
            outboxEvent.id,
            events.map((e) => e.id),
          ),
        );
      return events.length;
    });
  }
}
