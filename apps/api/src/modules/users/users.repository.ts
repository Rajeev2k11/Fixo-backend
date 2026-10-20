import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import type { UserStatus } from './domain/user.state-machine.js';
import type { WorkerStatus } from './domain/worker.state-machine.js';
import {
  adminProfile,
  adminRole,
  authIdentity,
  customerProfile,
  user,
  userAdminRole,
  userStatusHistory,
  workerAgreementAcceptance,
  workerStatusHistory,
  type WorkerProfileRow,
  type UserRow,
  workerProfile,
} from './users.schema.js';

export type AppRole = 'customer' | 'worker' | 'admin';
type IdentityType = 'phone' | 'email';

const PROFILE_TABLE = { customer: customerProfile, worker: workerProfile } as const;

/** The only code that reads or writes the users module's tables. */
@Injectable()
export class UsersRepository {
  /** Serialises sign-ups for one phone/email, so concurrent first logins create one user. */
  async lockIdentity(tx: Tx, type: IdentityType, value: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`auth_identity:${type}:${value}`}))`,
    );
  }

  async findUserIdByIdentity(
    tx: Db | Tx,
    type: IdentityType,
    value: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(and(eq(authIdentity.type, type), eq(authIdentity.value, value)));
    return row?.userId;
  }

  async createUserWithIdentity(tx: Tx, type: IdentityType, value: string): Promise<UserRow> {
    const [created] = await tx.insert(user).values({}).returning();
    if (!created) throw new Error('user insert returned no row');
    await tx
      .insert(authIdentity)
      .values({ userId: created.id, type, value, verifiedAt: new Date() });
    return created;
  }

  /** Adds the customer or worker profile if missing. Returns true when it was created now. */
  async ensureProfile(tx: Tx, userId: string, role: 'customer' | 'worker'): Promise<boolean> {
    const inserted = await tx
      .insert(PROFILE_TABLE[role])
      .values({ userId })
      .onConflictDoNothing()
      .returning({ id: PROFILE_TABLE[role].id });
    return inserted.length === 1;
  }

  async roles(db: Db | Tx, userId: string): Promise<AppRole[]> {
    const has = (table: typeof customerProfile | typeof workerProfile | typeof adminProfile) =>
      sql`exists (select 1 from ${table} where ${table.userId} = ${userId})`;
    const { rows } = await db.execute<Record<AppRole, boolean>>(
      sql`select ${has(customerProfile)} as customer, ${has(workerProfile)} as worker, ${has(adminProfile)} as admin`,
    );
    const row = rows[0];
    return (['customer', 'worker', 'admin'] as const).filter((role) => row?.[role]);
  }

  async findById(db: Db | Tx, id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(user).where(eq(user.id, id));
    return row;
  }

  async lockUser(tx: Tx, id: string): Promise<UserRow | undefined> {
    const [row] = await tx.select().from(user).where(eq(user.id, id)).for('update');
    return row;
  }

  /** Compare-and-set on version: returns undefined if someone else changed the row first. */
  async updateStatus(
    tx: Tx,
    id: string,
    to: UserStatus,
    expectedVersion: number,
  ): Promise<UserRow | undefined> {
    const [row] = await tx
      .update(user)
      .set({ status: to, version: sql`${user.version} + 1`, updatedAt: new Date() })
      .where(and(eq(user.id, id), eq(user.version, expectedVersion)))
      .returning();
    return row;
  }

  async insertHistory(tx: Tx, entry: typeof userStatusHistory.$inferInsert): Promise<void> {
    await tx.insert(userStatusHistory).values(entry);
  }

  async createAdminProfile(tx: Tx, userId: string, displayName: string): Promise<void> {
    await tx.insert(adminProfile).values({ userId, displayName });
  }

  /** Grants admin roles by code; throws if a code does not exist. */
  async grantAdminRoles(tx: Tx, userId: string, codes: string[]): Promise<void> {
    const roles = await tx.select().from(adminRole).where(inArray(adminRole.code, codes));
    const missing = codes.filter((c) => !roles.some((r) => r.code === c));
    if (missing.length > 0) throw new Error(`unknown admin role(s): ${missing.join(', ')}`);
    await tx.insert(userAdminRole).values(roles.map((r) => ({ userId, adminRoleId: r.id })));
  }

  async replaceAdminRoles(tx: Tx, userId: string, codes: string[]): Promise<void> {
    await tx.delete(userAdminRole).where(eq(userAdminRole.userId, userId));
    await this.grantAdminRoles(tx, userId, codes);
  }

  async adminRoleCodes(db: Db | Tx, userId: string): Promise<string[]> {
    const rows = await db
      .select({ code: adminRole.code })
      .from(userAdminRole)
      .innerJoin(adminRole, eq(adminRole.id, userAdminRole.adminRoleId))
      .where(eq(userAdminRole.userId, userId));
    return rows.map((r) => r.code).toSorted();
  }

  async findWorkerProfile(db: Db | Tx, userId: string): Promise<WorkerProfileRow | undefined> {
    const [row] = await db.select().from(workerProfile).where(eq(workerProfile.userId, userId));
    return row;
  }

  async lockWorkerProfile(tx: Tx, userId: string): Promise<WorkerProfileRow | undefined> {
    const [row] = await tx
      .select()
      .from(workerProfile)
      .where(eq(workerProfile.userId, userId))
      .for('update');
    return row;
  }

  async updateWorkerProfile(
    tx: Tx,
    userId: string,
    fields: { name?: string; photoMediaId?: string },
  ): Promise<void> {
    await tx
      .update(workerProfile)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(workerProfile.userId, userId));
  }

  async setUserCity(tx: Tx, userId: string, cityId: string): Promise<void> {
    await tx.update(user).set({ cityId, updatedAt: new Date() }).where(eq(user.id, userId));
  }

  /** Compare-and-set on version: undefined if someone else changed the profile first. */
  async updateWorkerStatus(
    tx: Tx,
    userId: string,
    to: WorkerStatus,
    statusReason: string | null,
    expectedVersion: number,
  ): Promise<WorkerProfileRow | undefined> {
    const [row] = await tx
      .update(workerProfile)
      .set({
        status: to,
        statusReason,
        version: sql`${workerProfile.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(workerProfile.userId, userId), eq(workerProfile.version, expectedVersion)))
      .returning();
    return row;
  }

  async insertWorkerHistory(tx: Tx, entry: typeof workerStatusHistory.$inferInsert): Promise<void> {
    await tx.insert(workerStatusHistory).values(entry);
  }

  /** Records an acceptance; accepting the same version again is a no-op. */
  async acceptAgreement(tx: Tx, userId: string, version: string): Promise<void> {
    await tx.insert(workerAgreementAcceptance).values({ userId, version }).onConflictDoNothing();
  }

  async latestAgreement(
    db: Db | Tx,
    userId: string,
  ): Promise<{ version: string; acceptedAt: Date } | undefined> {
    const [row] = await db
      .select({
        version: workerAgreementAcceptance.version,
        acceptedAt: workerAgreementAcceptance.acceptedAt,
      })
      .from(workerAgreementAcceptance)
      .where(eq(workerAgreementAcceptance.userId, userId))
      .orderBy(desc(workerAgreementAcceptance.acceptedAt))
      .limit(1);
    return row;
  }
}
