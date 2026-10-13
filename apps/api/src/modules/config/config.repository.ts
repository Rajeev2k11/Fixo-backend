import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import { configRule, type ConfigRuleRow } from './config.schema.js';
import type { Scope } from './domain/config.rules.js';

type Executor = Db | Tx;

const SCOPE_COLUMNS = ['cityId', 'zoneId', 'categoryId', 'subcategoryId', 'problemId'] as const;

/** Exactly this scope: each column equals the given id, or is null when none is given. */
function sameScope(scope: Scope): SQL[] {
  return SCOPE_COLUMNS.map((c) => {
    const id = scope[c];
    return id ? eq(configRule[c], id) : isNull(configRule[c]);
  });
}

/** The only code that reads or writes config_rule. */
@Injectable()
export class ConfigRepository {
  /** Approved versions in force at `at` whose scope fits the context (null columns match anything). */
  findCandidates(db: Executor, key: string, ctx: Scope, at: Date): Promise<ConfigRuleRow[]> {
    const fits = SCOPE_COLUMNS.map((c) => {
      const id = ctx[c];
      return id ? or(isNull(configRule[c]), eq(configRule[c], id)) : isNull(configRule[c]);
    });
    return db
      .select()
      .from(configRule)
      .where(
        and(
          eq(configRule.key, key),
          eq(configRule.status, 'approved'),
          lte(configRule.effectiveFrom, at),
          or(isNull(configRule.effectiveTo), gt(configRule.effectiveTo, at)),
          ...fits,
        ),
      );
  }

  /** Serialises all changes to one key, so version numbers and effective ranges never race. */
  async lockKey(tx: Tx, key: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`config_rule:${key}`}))`);
  }

  async nextVersion(tx: Tx, key: string, scope: Scope): Promise<number> {
    const [row] = await tx
      .select({ latest: max(configRule.version) })
      .from(configRule)
      .where(and(eq(configRule.key, key), ...sameScope(scope)));
    return (row?.latest ?? 0) + 1;
  }

  async insert(tx: Tx, values: typeof configRule.$inferInsert): Promise<ConfigRuleRow> {
    const [row] = await tx.insert(configRule).values(values).returning();
    if (!row) throw new Error('config_rule insert returned no row');
    return row;
  }

  async lockById(tx: Tx, id: string): Promise<ConfigRuleRow | undefined> {
    const [row] = await tx.select().from(configRule).where(eq(configRule.id, id)).for('update');
    return row;
  }

  /** Ends the version in force at `at` for this exact key and scope. Returns it, if any. */
  async closeOpenVersion(
    tx: Tx,
    key: string,
    scope: Scope,
    at: Date,
  ): Promise<ConfigRuleRow | undefined> {
    const [closed] = await tx
      .update(configRule)
      .set({ effectiveTo: at })
      .where(
        and(
          eq(configRule.key, key),
          ...sameScope(scope),
          eq(configRule.status, 'approved'),
          lte(configRule.effectiveFrom, at),
          or(isNull(configRule.effectiveTo), gt(configRule.effectiveTo, at)),
        ),
      )
      .returning();
    return closed;
  }

  async decide(
    tx: Tx,
    id: string,
    decision:
      | { status: 'approved'; approvedBy: string | null; effectiveFrom: Date }
      | { status: 'rejected' },
  ): Promise<ConfigRuleRow> {
    const [row] = await tx
      .update(configRule)
      .set({ ...decision, decidedAt: new Date() })
      .where(eq(configRule.id, id))
      .returning();
    if (!row) throw new Error(`config_rule ${id} vanished while locked`);
    return row;
  }
}
