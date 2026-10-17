import { type EventEnvelope, eventEnvelopeSchema } from '@fixo/contracts';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Worker } from 'bullmq';

import { DB, type Db, type Tx } from '../../common/db.js';
import { queuePrefix, redisOptions } from '../../common/redis.js';
import { markProcessed } from './outbox.js';
import { DOMAIN_EVENTS_QUEUE } from './outbox-relay.js';

/** A reaction to one event type. `consumer` names it for deduplication; never rename it. */
export interface EventHandler {
  consumer: string;
  eventType: string;
  handle(tx: Tx, event: EventEnvelope): Promise<void>;
}

export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');

/**
 * Runs every handler registered for an event. Each handler's effect and its processed-event
 * record commit in one transaction, so redelivery (at-least-once relay) applies it exactly once,
 * and a failed handler is retried without repeating the ones that already succeeded.
 */
@Injectable()
export class DomainEventsWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(DomainEventsWorker.name);
  private worker?: Worker<EventEnvelope>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<EventEnvelope>(
      DOMAIN_EVENTS_QUEUE,
      (job) => this.dispatch(eventEnvelopeSchema.parse(job.data)),
      { connection: redisOptions(), prefix: queuePrefix },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`event ${String(job?.id)} failed: ${err.message}`);
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async dispatch(event: EventEnvelope): Promise<void> {
    for (const handler of this.handlers.filter((h) => h.eventType === event.type)) {
      await this.db.transaction(async (tx) => {
        if (await markProcessed(tx, handler.consumer, event.id)) await handler.handle(tx, event);
      });
    }
  }
}
