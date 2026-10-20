import { ErrorCode } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { recordAudit } from '../../platform/audit/audit.js';
import { appendOutbox } from '../../platform/outbox/outbox.js';
import {
  canEditWorkerProfile,
  canTransitionWorker,
  type WorkerStatus,
} from './domain/worker.state-machine.js';
import { UsersRepository } from './users.repository.js';
import type { WorkerProfileRow } from './users.schema.js';

export type { WorkerStatus } from './domain/worker.state-machine.js';

export interface WorkerSnapshot {
  profile: WorkerProfileRow;
  cityId: string | null;
  agreement: { version: string; acceptedAt: Date } | undefined;
}

export interface WorkerTransition {
  userId: string;
  to: WorkerStatus;
  /** null = the system (e.g. KYC provider result, KYC expiry). */
  actor: Actor | null;
  reason: string;
  /** Shown to the worker (rejection or resubmission reason). */
  statusReason?: string | null | undefined;
  /** The version the caller saw; a mismatch means someone else changed it meanwhile. */
  expectedVersion?: number | undefined;
  requestId?: string | undefined;
}

const notAWorker = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Worker not found');

/** A worker's identity profile and onboarding status (decision WORKER-1). */
@Injectable()
export class WorkerProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: UsersRepository,
  ) {}

  async get(userId: string): Promise<WorkerSnapshot> {
    const [profile, owner, agreement] = await Promise.all([
      this.repo.findWorkerProfile(this.db, userId),
      this.repo.findById(this.db, userId),
      this.repo.latestAgreement(this.db, userId),
    ]);
    if (!profile || !owner) throw notAWorker();
    return { profile, cityId: owner.cityId, agreement };
  }

  /** Name, photo and city; only while the worker can still edit (before submitting). */
  async updateProfile(
    userId: string,
    fields: {
      name?: string | undefined;
      photoMediaId?: string | undefined;
      cityId?: string | undefined;
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const profile = await this.repo.lockWorkerProfile(tx, userId);
      if (!profile) throw notAWorker();
      if (!canEditWorkerProfile(profile.status)) {
        throw new AppError(
          ErrorCode.PROFILE_LOCKED,
          409,
          'Your profile is under review and cannot be changed now',
        );
      }
      const { name, photoMediaId, cityId } = fields;
      await this.repo.updateWorkerProfile(tx, userId, {
        ...(name !== undefined && { name }),
        ...(photoMediaId !== undefined && { photoMediaId }),
      });
      if (cityId !== undefined) await this.repo.setUserCity(tx, userId, cityId);
    });
  }

  async recordAgreement(userId: string, version: string): Promise<void> {
    await this.db.transaction((tx) => this.repo.acceptAgreement(tx, userId, version));
  }

  /**
   * The only way a worker's status changes (CLAUDE.md rule 3): checked against WORKER-1,
   * compare-and-set on version, history + event in one transaction, and an audit row when an
   * admin made the change (rule 12).
   */
  async transition(input: WorkerTransition): Promise<WorkerProfileRow> {
    return this.db.transaction(async (tx) => {
      const current = await this.repo.lockWorkerProfile(tx, input.userId);
      if (!current) throw notAWorker();
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        throw new AppError(
          ErrorCode.CONCURRENT_UPDATE,
          409,
          'This worker was changed by someone else; reload and try again',
          { currentVersion: current.version },
        );
      }
      if (!canTransitionWorker(current.status, input.to)) {
        throw new AppError(
          ErrorCode.INVALID_TRANSITION,
          409,
          `Cannot move a worker from ${current.status} to ${input.to}`,
        );
      }

      const updated = await this.repo.updateWorkerStatus(
        tx,
        input.userId,
        input.to,
        input.statusReason ?? null,
        current.version,
      );
      if (!updated) {
        throw new AppError(ErrorCode.CONCURRENT_UPDATE, 409, 'The worker was changed concurrently');
      }
      await this.repo.insertWorkerHistory(tx, {
        userId: input.userId,
        fromStatus: current.status,
        toStatus: input.to,
        actorUserId: input.actor?.userId ?? null,
        reason: input.reason,
      });
      const { actor } = input;
      if (actor && actor.userId !== input.userId) {
        // An admin acted on this worker (the worker's own submit is not an admin action).
        await recordAudit(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'worker.status_changed',
          entityType: 'worker',
          entityId: input.userId,
          before: { status: current.status },
          after: { status: input.to, statusReason: input.statusReason ?? null },
          reason: input.reason,
          ...(input.requestId && { requestId: input.requestId }),
        });
      }
      await appendOutbox(tx, {
        type: 'worker.status_changed',
        aggregateType: 'worker',
        aggregateId: input.userId,
        payload: { from: current.status, to: input.to },
      });
      return updated;
    });
  }
}
