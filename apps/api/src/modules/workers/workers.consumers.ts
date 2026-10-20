import type { EventEnvelope } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Tx } from '../../common/db.js';
import { KYC_CHECKER, type KycChecker } from '../../platform/kyc/kyc-checker.js';
import type { EventHandler } from '../../platform/outbox/domain-events.worker.js';
import { WorkerProfileService } from '../users/worker-profile.service.js';

/**
 * WORKER-1: KYC_PENDING -> UNDER_REVIEW once the automated KYC check has run, which puts the
 * worker in the admin verification queue. Runs in the jobs process.
 */
@Injectable()
export class RunKycCheckOnSubmit implements EventHandler {
  readonly consumer = 'workers.run_kyc_check_on_submit';
  readonly eventType = 'worker.status_changed';

  constructor(
    private readonly workers: WorkerProfileService,
    @Inject(KYC_CHECKER) private readonly kyc: KycChecker,
  ) {}

  async handle(tx: Tx, event: EventEnvelope): Promise<void> {
    if (event.payload.to !== 'kyc_pending') return;
    // ponytail: the fake check needs no files; a real provider will need the KYC media ids here.
    const result = await this.kyc.check({
      userId: event.aggregateId,
      aadhaarFrontMediaId: '',
      selfieMediaId: '',
    });
    await this.workers.transition(
      {
        userId: event.aggregateId,
        to: 'under_review',
        actor: null,
        reason: `automated KYC check ${result.outcome}: ${result.note}`,
      },
      tx,
    );
  }
}
