import { randomInt, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import type { Actor } from '../../src/common/actor.js';
import { AppError } from '../../src/common/app-error.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import {
  adminRole,
  authIdentity,
  userStatusHistory,
} from '../../src/modules/users/users.schema.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { auditLog } from '../../src/platform/audit/audit.schema.js';
import { outboxEvent } from '../../src/platform/outbox/outbox.schema.js';
import { createUser } from './helpers.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });
const users = new UsersService(db, new UsersRepository());
afterAll(() => pool.end());

const admin: Actor = { userId: await createUser(pool), role: 'operations' };
const newPhone = () => `9${String(randomInt(0, 1e9)).padStart(9, '0')}`;

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  throw new Error('expected an AppError');
}

describe('findOrCreateByPhone', () => {
  it('creates user, normalised identity, profile, history and event in one go', async () => {
    const phone = newPhone();

    const result = await users.findOrCreateByPhone(
      `0${phone.slice(0, 5)} ${phone.slice(5)}`,
      'customer',
    );

    expect(result).toMatchObject({ status: 'active', roles: ['customer'], isNew: true });
    const [identity] = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.userId, result.userId));
    expect(identity).toMatchObject({ type: 'phone', value: `+91${phone}` });
    expect(identity?.verifiedAt).toBeInstanceOf(Date);
    const history = await db
      .select()
      .from(userStatusHistory)
      .where(eq(userStatusHistory.userId, result.userId));
    expect(history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'active' })]);
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.aggregateId, result.userId), eq(outboxEvent.type, 'user.created')));
    expect(event?.payload).toEqual({ role: 'customer' });
    expect(JSON.stringify(event)).not.toContain(phone); // events never carry the phone number
  });

  it('returns the same user on the next login, whatever the number format', async () => {
    const phone = newPhone();
    const first = await users.findOrCreateByPhone(phone, 'customer');

    const again = await users.findOrCreateByPhone(`+91-${phone}`, 'customer');

    expect(again).toMatchObject({ userId: first.userId, isNew: false });
  });

  it('gives an existing customer a worker profile on the same account (multi-role)', async () => {
    const phone = newPhone();
    const asCustomer = await users.findOrCreateByPhone(phone, 'customer');

    const asWorker = await users.findOrCreateByPhone(phone, 'worker');

    expect(asWorker.userId).toBe(asCustomer.userId);
    expect(asWorker.roles).toEqual(['customer', 'worker']);
  });

  it('creates exactly one user under 10 concurrent first logins', async () => {
    const phone = newPhone();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => users.findOrCreateByPhone(phone, 'worker')),
    );

    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    expect(results.filter((r) => r.isNew)).toHaveLength(1);
    const identities = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.value, `+91${phone}`));
    expect(identities).toHaveLength(1);
  });

  it('rejects a number that is not an Indian mobile', async () => {
    await expect(users.findOrCreateByPhone('12345', 'customer')).rejects.toThrow();
  });
});

describe('admin roles', () => {
  it('are seeded with the five roles from the spec', async () => {
    const roles = await db.select({ code: adminRole.code }).from(adminRole);

    expect(roles.map((r) => r.code).toSorted()).toEqual([
      'finance',
      'operations',
      'super_admin',
      'support',
      'verification',
    ]);
  });
});

describe('transitionStatus', () => {
  const signUp = async () => (await users.findOrCreateByPhone(newPhone(), 'worker')).userId;

  it('suspends with history, audit and an event, bumping the version', async () => {
    const userId = await signUp();

    const updated = await users.transitionStatus({
      userId,
      to: 'suspended',
      actor: admin,
      reason: 'Repeated no-shows',
      expectedVersion: 1,
    });

    expect(updated).toMatchObject({ status: 'suspended', version: 2 });
    const history = await db
      .select()
      .from(userStatusHistory)
      .where(eq(userStatusHistory.userId, userId));
    expect(history.map((h) => h.toStatus)).toEqual(['active', 'suspended']);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.entityId, userId));
    expect(audit).toMatchObject({ action: 'user.status_changed', reason: 'Repeated no-shows' });
    const events = await db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.aggregateId, userId), eq(outboxEvent.type, 'user.status_changed')));
    expect(events.map((e) => e.payload)).toEqual([{ from: 'active', to: 'suspended' }]);
  });

  it('rejects a move the state machine does not allow', async () => {
    const userId = await signUp();
    await users.transitionStatus({ userId, to: 'blocked', actor: admin, reason: 'fraud' });

    const code = await errorCode(
      users.transitionStatus({ userId, to: 'suspended', actor: admin, reason: 'x' }),
    );

    expect(code).toBe('INVALID_TRANSITION');
  });

  it('rejects a stale version (someone else changed the account)', async () => {
    const userId = await signUp();
    await users.transitionStatus({ userId, to: 'suspended', actor: admin, reason: 'first' });

    const code = await errorCode(
      users.transitionStatus({
        userId,
        to: 'active',
        actor: admin,
        reason: 'based on an old screen',
        expectedVersion: 1,
      }),
    );

    expect(code).toBe('CONCURRENT_UPDATE');
  });

  it('lets only one of two simultaneous admin actions win', async () => {
    const userId = await signUp();

    const outcomes = await Promise.allSettled([
      users.transitionStatus({
        userId,
        to: 'suspended',
        actor: admin,
        reason: 'a',
        expectedVersion: 1,
      }),
      users.transitionStatus({
        userId,
        to: 'blocked',
        actor: admin,
        reason: 'b',
        expectedVersion: 1,
      }),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((o) => o.status === 'rejected');
    expect((failed?.reason as AppError).code).toBe('CONCURRENT_UPDATE');
  });

  it('returns NOT_FOUND for an unknown user', async () => {
    const code = await errorCode(
      users.transitionStatus({ userId: randomUUID(), to: 'suspended', actor: admin, reason: 'x' }),
    );

    expect(code).toBe('NOT_FOUND');
  });
});
