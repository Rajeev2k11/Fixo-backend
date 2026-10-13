import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../src/common/app-error.js';
import { defineConfigKey } from '../../src/modules/config/config.keys.js';
import { ConfigRepository } from '../../src/modules/config/config.repository.js';
import { configRule } from '../../src/modules/config/config.schema.js';
import { type Actor, ConfigService } from '../../src/modules/config/config.service.js';
import { auditLog } from '../../src/platform/audit/audit.schema.js';
import { outboxEvent } from '../../src/platform/outbox/outbox.schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });
const config = new ConfigService(db, new ConfigRepository());
afterAll(() => pool.end());
beforeEach(() => db.delete(configRule));

const LUCKNOW = 'd4046302-ed40-4bd0-84a7-7a9c98614777'; // seeded in migration 0001
const RADIUS = defineConfigKey('test.radius_km', z.number().positive());
const LEAD_FEE = defineConfigKey('test.revenue.lead_fee_paise', z.int().min(0), {
  requiresApproval: true,
});

const ops: Actor = { userId: randomUUID(), role: 'operations' };
const superAdmin: Actor = { userId: randomUUID(), role: 'super_admin' };
const finance: Actor = { userId: randomUUID(), role: 'finance' };
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

function set(value: unknown, scope = {}, effectiveFrom?: Date) {
  return config.propose({
    key: RADIUS.name,
    scope,
    value,
    reason: 'test',
    actor: ops,
    ...(effectiveFrom && { effectiveFrom }),
  });
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  throw new Error('expected an AppError');
}

describe('resolve', () => {
  it('fails with CONFIG_NOT_SET when nothing is configured', async () => {
    expect(await errorCode(config.resolve(RADIUS))).toBe('CONFIG_NOT_SET');
  });

  it('returns the value and the version id to snapshot', async () => {
    const row = await set(5);

    expect(await config.resolve(RADIUS)).toEqual({ value: 5, versionId: row.id });
  });

  it('picks the most specific scope (SPEC-1) for the given context', async () => {
    const zoneId = randomUUID();
    const categoryId = randomUUID();
    const problemId = randomUUID();
    await set(1); // global
    await set(2, { cityId: LUCKNOW });
    await set(3, { zoneId });
    await set(4, { categoryId });
    await set(5, { problemId, cityId: LUCKNOW });

    const value = async (ctx: object) => (await config.resolve(RADIUS, ctx)).value;
    expect(await value({})).toBe(1);
    expect(await value({ cityId: LUCKNOW })).toBe(2);
    expect(await value({ cityId: LUCKNOW, zoneId })).toBe(3);
    expect(await value({ cityId: LUCKNOW, zoneId, categoryId })).toBe(4); // catalogue beats geo
    expect(await value({ cityId: LUCKNOW, zoneId, categoryId, problemId })).toBe(5);
    expect(await value({ problemId })).toBe(1); // problem rule is Lucknow-only
  });
});

describe('versioning', () => {
  it('a future-dated version waits for its effective time', async () => {
    await set(5);
    await set(8, {}, hoursFromNow(1));

    expect((await config.resolve(RADIUS)).value).toBe(5);
    expect((await config.resolve(RADIUS, {}, hoursFromNow(2))).value).toBe(8);
  });

  it('a new version closes the previous one but never rewrites it', async () => {
    const v1 = await set(5);
    const before = new Date();
    const v2 = await set(7);

    const [old] = await db.select().from(configRule).where(eq(configRule.id, v1.id));
    expect(old?.value).toBe(5);
    expect(old?.effectiveTo).toEqual(v2.effectiveFrom);
    expect(v2.version).toBe(2);
    expect((await config.resolve(RADIUS, {}, before)).value).toBe(5);
  });

  it('never backdates: a past effectiveFrom starts now', async () => {
    const row = await set(5, {}, hoursFromNow(-24));

    expect(row.effectiveFrom.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('writes an audit row and a config.changed event when a version takes effect', async () => {
    const row = await set(5);

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits.map((a) => a.action).toSorted()).toEqual([
      'config.rule.activated',
      'config.rule.proposed',
    ]);
    const events = await db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.aggregateId, row.id), eq(outboxEvent.type, 'config.changed')));
    expect(events).toHaveLength(1);
  });
});

describe('validation', () => {
  it('rejects a value that fails the key schema', async () => {
    expect(await errorCode(set(-1))).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown key', async () => {
    const promise = config.propose({ key: 'no.such', value: 1, reason: 'x', actor: ops });
    expect(await errorCode(promise)).toBe('CONFIG_KEY_UNKNOWN');
  });

  it('rejects a scope with two geography levels', async () => {
    expect(await errorCode(set(1, { cityId: LUCKNOW, zoneId: randomUUID() }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('maker-checker for revenue rules (SPEC-2)', () => {
  const propose = () =>
    config.propose({
      key: LEAD_FEE.name,
      value: 0,
      reason: 'Free launch period (OBD-1)',
      actor: superAdmin,
    });

  it('a proposal waits, the maker cannot approve it, a second admin can', async () => {
    const draft = await propose();
    expect(draft.status).toBe('pending');
    expect(await errorCode(config.resolve(LEAD_FEE))).toBe('CONFIG_NOT_SET');

    expect(await errorCode(config.approve(draft.id, superAdmin, 'self'))).toBe(
      'MAKER_CANNOT_APPROVE',
    );

    const approved = await config.approve(draft.id, finance, 'Checked against OBD-1');
    expect(approved.approvedBy).toBe(finance.userId);
    expect(await config.resolve(LEAD_FEE)).toEqual({ value: 0, versionId: draft.id });

    expect(await errorCode(config.approve(draft.id, finance, 'again'))).toBe('CONFIG_NOT_PENDING');
  });

  it('a rejected proposal never takes effect', async () => {
    const draft = await propose();

    await config.reject(draft.id, finance, 'Wrong amount');

    expect(await errorCode(config.resolve(LEAD_FEE))).toBe('CONFIG_NOT_SET');
    expect(await errorCode(config.approve(draft.id, finance, 'late'))).toBe('CONFIG_NOT_PENDING');
  });

  it('the database itself refuses maker = checker', async () => {
    const draft = await propose();

    const attempt = db
      .update(configRule)
      .set({ status: 'approved', approvedBy: superAdmin.userId })
      .where(eq(configRule.id, draft.id));

    await expect(attempt).rejects.toMatchObject({
      cause: { constraint: 'config_rule_maker_checker_check' },
    });
  });
});

describe('database guarantees', () => {
  it('refuses two approved versions overlapping in time for the same key and scope', async () => {
    await set(5); // open-ended from now

    const overlapping = db.insert(configRule).values({
      key: RADIUS.name,
      value: 9,
      version: 99,
      status: 'approved',
      effectiveFrom: hoursFromNow(1),
      reason: 'bypassing the service',
      createdBy: ops.userId,
    });

    await expect(overlapping).rejects.toMatchObject({ cause: { code: '23P01' } });
  });

  it('maps an overlap with an already-scheduled future version to CONFIG_OVERLAP', async () => {
    await set(5, {}, hoursFromNow(2)); // scheduled, open-ended
    // A version from now would run into the scheduled one, which the service does not close.
    expect(await errorCode(set(6))).toBe('CONFIG_OVERLAP');
  });
});
