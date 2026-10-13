import { ErrorCode } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { DB, type Db, type Tx } from '../../common/db.js';
import { recordAudit } from '../../platform/audit/audit.js';
import { appendOutbox } from '../../platform/outbox/outbox.js';
import { configKey, type ConfigKey } from './config.keys.js';
import { ConfigRepository } from './config.repository.js';
import type { ConfigRuleRow } from './config.schema.js';
import { isValidRuleScope, mostSpecific, type Scope } from './domain/config.rules.js';

export interface Actor {
  userId: string;
  role: string;
}

export interface Resolved<T> {
  value: T;
  /** Stored by bookings as their rule snapshot (spec §E rule 4). */
  versionId: string;
}

export interface ProposeInput {
  key: string;
  scope?: Scope;
  value: unknown;
  /** Defaults to now; a past date is moved up to the moment of activation (no backdating). */
  effectiveFrom?: Date;
  reason: string;
  actor: Actor;
  requestId?: string;
}

@Injectable()
export class ConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ConfigRepository,
  ) {}

  /** The most specific approved value in force at `at` (SPEC-1), validated against the key's schema. */
  async resolve<T>(key: ConfigKey<T>, ctx: Scope = {}, at = new Date()): Promise<Resolved<T>> {
    const best = mostSpecific(await this.repo.findCandidates(this.db, key.name, ctx, at));
    if (!best) {
      throw new AppError(ErrorCode.CONFIG_NOT_SET, 500, `No value configured for ${key.name}`, {
        key: key.name,
        scope: ctx,
      });
    }
    return { value: key.schema.parse(best.value), versionId: best.id };
  }

  /**
   * Creates a new version. Keys that need approval (SPEC-2) wait as 'pending' for a second admin;
   * all others take effect at effectiveFrom straight away.
   */
  async propose(input: ProposeInput): Promise<ConfigRuleRow> {
    const key = configKey(input.key);
    const scope = input.scope ?? {};
    if (!isValidRuleScope(scope)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'A rule scope may name one geography level and one catalogue level',
      );
    }
    const parsed = key.schema.safeParse(input.value);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Invalid value for ${key.name}`,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    return this.withOverlapMapped(() =>
      this.db.transaction(async (tx) => {
        await this.repo.lockKey(tx, key.name);
        const row = await this.repo.insert(tx, {
          key: key.name,
          cityId: scope.cityId ?? null,
          zoneId: scope.zoneId ?? null,
          categoryId: scope.categoryId ?? null,
          subcategoryId: scope.subcategoryId ?? null,
          problemId: scope.problemId ?? null,
          value: parsed.data,
          version: await this.repo.nextVersion(tx, key.name, scope),
          status: 'pending',
          effectiveFrom: input.effectiveFrom ?? new Date(),
          reason: input.reason,
          createdBy: input.actor.userId,
        });
        await this.audit(tx, input.actor, 'config.rule.proposed', row, null, input);
        if (key.requiresApproval) return row;
        return this.activate(tx, row, null, input.actor, input);
      }),
    );
  }

  /** SPEC-2: a different admin approves a pending version, which then takes effect. */
  async approve(
    id: string,
    approver: Actor,
    reason: string,
    requestId?: string,
  ): Promise<ConfigRuleRow> {
    return this.withOverlapMapped(() =>
      this.db.transaction(async (tx) => {
        const row = await this.pending(tx, id);
        if (row.createdBy === approver.userId) {
          throw new AppError(
            ErrorCode.MAKER_CANNOT_APPROVE,
            403,
            'A rule change must be approved by a different admin',
          );
        }
        await this.repo.lockKey(tx, row.key);
        return this.activate(tx, row, approver.userId, approver, { reason, requestId });
      }),
    );
  }

  async reject(
    id: string,
    actor: Actor,
    reason: string,
    requestId?: string,
  ): Promise<ConfigRuleRow> {
    return this.db.transaction(async (tx) => {
      const row = await this.pending(tx, id);
      const rejected = await this.repo.decide(tx, id, { status: 'rejected' });
      await this.audit(tx, actor, 'config.rule.rejected', rejected, row, { reason, requestId });
      return rejected;
    });
  }

  private async pending(tx: Tx, id: string): Promise<ConfigRuleRow> {
    const row = await this.repo.lockById(tx, id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 404, 'Config rule version not found');
    if (row.status !== 'pending') {
      throw new AppError(
        ErrorCode.CONFIG_NOT_PENDING,
        409,
        `This version is already ${row.status}`,
      );
    }
    return row;
  }

  /** Puts a version in force: closes the previous one, records audit and a config.changed event. */
  private async activate(
    tx: Tx,
    row: ConfigRuleRow,
    approvedBy: string | null,
    actor: Actor,
    meta: { reason: string; requestId?: string | undefined },
  ): Promise<ConfigRuleRow> {
    const now = new Date();
    const effectiveFrom = row.effectiveFrom > now ? row.effectiveFrom : now;
    const previous = await this.repo.closeOpenVersion(tx, row.key, row, effectiveFrom);
    const active = await this.repo.decide(tx, row.id, {
      status: 'approved',
      approvedBy,
      effectiveFrom,
    });
    await this.audit(tx, actor, 'config.rule.activated', active, previous ?? null, meta);
    await appendOutbox(tx, {
      type: 'config.changed',
      aggregateType: 'config_rule',
      aggregateId: active.id,
      payload: {
        key: active.key,
        version: active.version,
        effectiveFrom: effectiveFrom.toISOString(),
      },
    });
    return active;
  }

  private audit(
    tx: Tx,
    actor: Actor,
    action: string,
    after: ConfigRuleRow,
    before: ConfigRuleRow | null,
    meta: { reason: string; requestId?: string | undefined },
  ): Promise<void> {
    return recordAudit(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      entityType: 'config_rule',
      entityId: after.id,
      before,
      after,
      reason: meta.reason,
      ...(meta.requestId && { requestId: meta.requestId }),
    });
  }

  /** The database's no-overlap constraint fires when a future version already covers the range. */
  private async withOverlapMapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === '23P01') {
        throw new AppError(
          ErrorCode.CONFIG_OVERLAP,
          409,
          'Another approved version already covers part of this period',
          null,
          { cause: err },
        );
      }
      throw err;
    }
  }
}
