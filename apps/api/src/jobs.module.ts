import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { LoggerModule } from 'nestjs-pino';

import { DbModule } from './common/db.js';
import { env } from './common/env.js';
import { loggerParams } from './common/logger.js';
import { queuePrefix, redisOptions } from './common/redis.js';
import { RevokeSessionsOnRestriction } from './modules/auth/auth.consumers.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import {
  DomainEventsWorker,
  EVENT_HANDLERS,
  type EventHandler,
} from './platform/outbox/domain-events.worker.js';
import { DOMAIN_EVENTS_QUEUE, EVENT_QUEUE, OutboxRelay } from './platform/outbox/outbox-relay.js';
import { SmsWorkerModule } from './platform/sms/sms.js';

/**
 * Root module of the background worker process (apps/jobs). Lives in the API package so both
 * processes share the same modules: same code, separate entry point.
 */
@Module({
  imports: [LoggerModule.forRoot(loggerParams(env)), DbModule, SmsWorkerModule],
  providers: [
    {
      provide: EVENT_QUEUE,
      useFactory: () =>
        new Queue(DOMAIN_EVENTS_QUEUE, { connection: redisOptions(), prefix: queuePrefix }),
    },
    OutboxRelay,
    // Event consumers: add each module's handlers to EVENT_HANDLERS.
    AuthRepository,
    RevokeSessionsOnRestriction,
    {
      provide: EVENT_HANDLERS,
      inject: [RevokeSessionsOnRestriction],
      useFactory: (...handlers: EventHandler[]) => handlers,
    },
    DomainEventsWorker,
  ],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(EVENT_QUEUE) private readonly queue: Queue) {}

  // The relay stops in beforeApplicationShutdown, so the queue is idle by now.
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
