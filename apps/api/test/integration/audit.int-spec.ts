import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type AuditEntry, recordAudit } from '../../src/platform/audit/audit.js';
import { auditLog } from '../../src/platform/audit/audit.schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });
afterAll(() => pool.end());

// audit_log cannot be truncated, so every test uses its own entity id instead of a clean table.
function entry(entityId = randomUUID()): AuditEntry {
  return {
    actorUserId: randomUUID(),
    actorRole: 'super_admin',
    action: 'config.rule.changed',
    entityType: 'marketplace_setting',
    entityId,
    before: { leadCap: 1 },
    after: { leadCap: 2 },
    reason: 'Not enough quotes per booking in week 1',
  };
}

const rowsFor = (entityId: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityId, entityId));

/** Drizzle wraps driver errors; the Postgres error with code/constraint is the cause. */
async function pgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { cause?: unknown };
    return (e.cause ?? err) as { code?: string; constraint?: string; message: string };
  }
  throw new Error('expected the database to reject this');
}

describe('recordAudit', () => {
  it('commits the audit row with the change it describes', async () => {
    const e = entry();

    await db.transaction((tx) => recordAudit(tx, e));

    expect(await rowsFor(e.entityId)).toEqual([
      expect.objectContaining({
        action: e.action,
        before: e.before,
        after: e.after,
        reason: e.reason,
      }),
    ]);
  });

  it('disappears with a rolled-back change', async () => {
    const e = entry();

    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, e);
        throw new Error('the change itself failed');
      }),
    ).rejects.toThrow('the change itself failed');

    expect(await rowsFor(e.entityId)).toEqual([]);
  });

  it('is rejected by the database without a reason', async () => {
    const err = await pgError(
      db.transaction((tx) => recordAudit(tx, { ...entry(), reason: '   ' })),
    );

    expect(err.constraint).toBe('audit_log_reason_check');
  });
});

describe('audit_log is append-only at the database level', () => {
  it.each([
    ['UPDATE', `update audit_log set reason = 'rewritten' where entity_id = $1`],
    ['DELETE', `delete from audit_log where entity_id = $1`],
  ])('rejects %s', async (_op, statement) => {
    const e = entry();
    await db.transaction((tx) => recordAudit(tx, e));

    const err = await pgError(pool.query(statement, [e.entityId]));

    expect(err.code).toBe('42501'); // insufficient_privilege
    expect(err.message).toMatch(/append-only/);
    expect(await rowsFor(e.entityId)).toEqual([expect.objectContaining({ reason: e.reason })]);
  });

  it('rejects TRUNCATE', async () => {
    const err = await pgError(pool.query('truncate audit_log'));

    expect(err.code).toBe('42501');
    expect(err.message).toMatch(/append-only: TRUNCATE/);
  });
});
