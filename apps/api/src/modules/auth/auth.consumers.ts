import type { EventEnvelope } from '@fixo/contracts';
import { Injectable } from '@nestjs/common';

import type { Tx } from '../../common/db.js';
import type { EventHandler } from '../../platform/outbox/domain-events.worker.js';
import { AuthRepository } from './auth.repository.js';

/** Spec §M: suspended or blocked users have their sessions revoked (runs in the jobs process). */
@Injectable()
export class RevokeSessionsOnRestriction implements EventHandler {
  readonly consumer = 'auth.revoke_sessions_on_restriction';
  readonly eventType = 'user.status_changed';

  constructor(private readonly repo: AuthRepository) {}

  async handle(tx: Tx, event: EventEnvelope): Promise<void> {
    const to = event.payload.to;
    if (to === 'suspended' || to === 'blocked') {
      await this.repo.revokeAllSessions(tx, event.aggregateId, `account_${to}`);
    }
  }
}
