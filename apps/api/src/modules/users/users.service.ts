import { ErrorCode, indianMobileSchema } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { recordAudit } from '../../platform/audit/audit.js';
import { appendOutbox } from '../../platform/outbox/outbox.js';
import { canTransition, type UserStatus } from './domain/user.state-machine.js';
import { type AppRole, UsersRepository } from './users.repository.js';
import type { UserRow } from './users.schema.js';

export type { AppRole } from './users.repository.js';

export interface UserSummary {
  userId: string;
  status: UserStatus;
  roles: AppRole[];
  isNew: boolean;
}

export interface TransitionInput {
  userId: string;
  to: UserStatus;
  actor: Actor;
  reason: string;
  /** The version the admin saw; a mismatch means someone else changed the account meanwhile. */
  expectedVersion?: number;
  requestId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: UsersRepository,
  ) {}

  /**
   * Called after a phone OTP is verified (step 1.9). Creates the user on first login, and adds
   * the customer or worker profile the app is asking for: one person can hold both roles (spec §M).
   */
  async findOrCreateByPhone(phone: string, role: 'customer' | 'worker'): Promise<UserSummary> {
    const value = indianMobileSchema.parse(phone);
    return this.db.transaction(async (tx) => {
      await this.repo.lockIdentity(tx, 'phone', value);
      let userId = await this.repo.findUserIdByIdentity(tx, 'phone', value);
      const isNew = userId === undefined;

      if (userId === undefined) {
        const created = await this.repo.createUserWithIdentity(tx, 'phone', value);
        userId = created.id;
        await this.repo.insertHistory(tx, {
          userId,
          fromStatus: null,
          toStatus: created.status,
          actorUserId: null,
          reason: 'sign-up',
        });
        await appendOutbox(tx, {
          type: 'user.created',
          aggregateType: 'user',
          aggregateId: userId,
          payload: { role }, // never the phone number: events are logged and fanned out
        });
      }

      await this.repo.ensureProfile(tx, userId, role);
      const locked = await this.repo.lockUser(tx, userId);
      if (!locked) throw new Error(`user ${userId} vanished`);
      return { userId, status: locked.status, roles: await this.repo.roles(tx, userId), isNew };
    });
  }

  /**
   * Creates an admin account with an email identity and admin roles (spec §D). Admins have no
   * phone; they log in with email + password + MFA (step 1.11). Audited as an account action.
   */
  async createAdmin(input: {
    email: string;
    displayName: string;
    roleCodes: string[];
    actor: Actor;
    reason: string;
  }): Promise<string> {
    const email = input.email.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      await this.repo.lockIdentity(tx, 'email', email);
      if (await this.repo.findUserIdByIdentity(tx, 'email', email)) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `An account for ${email} already exists`,
        );
      }
      const created = await this.repo.createUserWithIdentity(tx, 'email', email);
      await this.repo.createAdminProfile(tx, created.id, input.displayName);
      await this.repo.grantAdminRoles(tx, created.id, input.roleCodes);
      await this.repo.insertHistory(tx, {
        userId: created.id,
        fromStatus: null,
        toStatus: created.status,
        actorUserId: input.actor.userId,
        reason: input.reason,
      });
      await recordAudit(tx, {
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        action: 'user.admin_created',
        entityType: 'user',
        entityId: created.id,
        before: null,
        after: { roles: input.roleCodes },
        reason: input.reason,
      });
      await appendOutbox(tx, {
        type: 'user.created',
        aggregateType: 'user',
        aggregateId: created.id,
        payload: { role: 'admin' },
      });
      return created.id;
    });
  }

  async findUserIdByEmail(email: string): Promise<string | undefined> {
    return this.repo.findUserIdByIdentity(this.db, 'email', email.trim().toLowerCase());
  }

  adminRoleCodes(userId: string): Promise<string[]> {
    return this.repo.adminRoleCodes(this.db, userId);
  }

  /**
   * Replaces an admin's roles (audited). Admins cannot change their own roles, so the last
   * super admin cannot lock everyone out by accident.
   */
  async setAdminRoles(input: {
    userId: string;
    roleCodes: string[];
    actor: Actor;
    reason: string;
  }): Promise<void> {
    if (input.userId === input.actor.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admins cannot change their own roles');
    }
    await this.db.transaction(async (tx) => {
      const locked = await this.repo.lockUser(tx, input.userId);
      const before = locked ? await this.repo.adminRoleCodes(tx, input.userId) : [];
      if (!locked || before.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Admin not found');
      }
      await this.repo.replaceAdminRoles(tx, input.userId, input.roleCodes);
      await recordAudit(tx, {
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        action: 'user.admin_roles_changed',
        entityType: 'user',
        entityId: input.userId,
        before: { roles: before },
        after: { roles: [...input.roleCodes].sort() },
        reason: input.reason,
      });
    });
  }

  /** Current account status, or undefined if the user does not exist. Checked on every request. */
  async getStatus(userId: string): Promise<UserStatus | undefined> {
    return (await this.repo.findById(this.db, userId))?.status;
  }

  /**
   * The only way an account's status changes: checked against the state machine, compare-and-set
   * on version, and history + audit + outbox event in the same transaction (CLAUDE.md rules 3, 12).
   */
  async transitionStatus(input: TransitionInput): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const current = await this.repo.lockUser(tx, input.userId);
      if (!current) throw new AppError(ErrorCode.NOT_FOUND, 404, 'User not found');
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        throw new AppError(
          ErrorCode.CONCURRENT_UPDATE,
          409,
          'The account was changed by someone else; reload and try again',
          { currentVersion: current.version },
        );
      }
      if (!canTransition(current.status, input.to)) {
        throw new AppError(
          ErrorCode.INVALID_TRANSITION,
          409,
          `Cannot move an account from ${current.status} to ${input.to}`,
        );
      }

      const updated = await this.repo.updateStatus(tx, current.id, input.to, current.version);
      if (!updated) {
        throw new AppError(
          ErrorCode.CONCURRENT_UPDATE,
          409,
          'The account was changed concurrently',
        );
      }
      await this.repo.insertHistory(tx, {
        userId: current.id,
        fromStatus: current.status,
        toStatus: input.to,
        actorUserId: input.actor.userId,
        reason: input.reason,
      });
      await recordAudit(tx, {
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        action: 'user.status_changed',
        entityType: 'user',
        entityId: current.id,
        before: { status: current.status },
        after: { status: input.to },
        reason: input.reason,
        ...(input.requestId && { requestId: input.requestId }),
      });
      // Consumers (step 1.10) revoke sessions of suspended or blocked users.
      await appendOutbox(tx, {
        type: 'user.status_changed',
        aggregateType: 'user',
        aggregateId: current.id,
        payload: { from: current.status, to: input.to },
      });
      return updated;
    });
  }
}
