import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import type { UserStatus } from './domain/user.state-machine.js';
import {
  adminProfile,
  authIdentity,
  customerProfile,
  user,
  userStatusHistory,
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
    tx: Tx,
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
}
