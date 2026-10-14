import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

import { maskPhone } from '../../common/logger.js';
import { queuePrefix, redisOptions } from '../../common/redis.js';

/** CLAUDE.md rule 11: every external service sits behind an interface with a Fake. */
export interface SmsSender {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

/** Dev/test provider: prints the OTP to the console instead of sending it. Refused in production. */
@Injectable()
export class FakeSms implements SmsSender {
  private readonly logger = new Logger('FakeSms');

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${maskPhone(phoneE164)}: ${code}`);
    return Promise.resolve();
  }
}

export const SMS_QUEUE_NAME = 'sms';
export const SMS_QUEUE = Symbol('SMS_QUEUE');
export const SMS_SENDER = Symbol('SMS_SENDER');

export interface OtpSmsJob {
  phone: string;
  code: string;
}

/**
 * OTP codes go straight onto a BullMQ queue, not the outbox: the outbox is a durable table and
 * its rows are logged and fanned out, which a secret must never be. The job is deleted once done.
 */
export function enqueueOtpSms(queue: Queue, job: OtpSmsJob): Promise<unknown> {
  return queue.add('otp', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/** API side: lets services enqueue SMS jobs. */
@Module({
  providers: [
    {
      provide: SMS_QUEUE,
      useFactory: () =>
        new Queue(SMS_QUEUE_NAME, { connection: redisOptions(), prefix: queuePrefix }),
    },
  ],
  exports: [SMS_QUEUE],
})
export class SmsQueueModule implements BeforeApplicationShutdown {
  constructor(@Inject(SMS_QUEUE) private readonly queue: Queue) {}

  async beforeApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** Jobs side: sends queued SMS through the configured provider. */
@Injectable()
export class SmsWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private worker?: Worker<OtpSmsJob>;

  constructor(@Inject(SMS_SENDER) private readonly sender: SmsSender) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<OtpSmsJob>(
      SMS_QUEUE_NAME,
      (job) => this.sender.sendOtp(job.data.phone, job.data.code),
      { connection: redisOptions(), prefix: queuePrefix },
    );
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}

@Module({
  providers: [{ provide: SMS_SENDER, useClass: FakeSms }, SmsWorker],
})
export class SmsWorkerModule {}
