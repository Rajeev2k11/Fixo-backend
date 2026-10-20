import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import { serviceCategory } from './catalogue.schema.js';

/** The only code that reads or writes the catalogue tables. */
@Injectable()
export class CatalogueRepository {
  listActiveCategories(db: Db | Tx): Promise<{ id: string; slug: string; name: string }[]> {
    return db
      .select({ id: serviceCategory.id, slug: serviceCategory.slug, name: serviceCategory.name })
      .from(serviceCategory)
      .where(eq(serviceCategory.isActive, true))
      .orderBy(asc(serviceCategory.sortOrder), asc(serviceCategory.name));
  }

  async activeCategoryIds(db: Db | Tx, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: serviceCategory.id })
      .from(serviceCategory)
      .where(and(inArray(serviceCategory.id, ids), eq(serviceCategory.isActive, true)));
    return rows.map((r) => r.id);
  }

  async insertCategory(
    tx: Tx,
    values: typeof serviceCategory.$inferInsert,
  ): Promise<typeof serviceCategory.$inferSelect> {
    const [row] = await tx.insert(serviceCategory).values(values).returning();
    if (!row) throw new Error('service_category insert returned no row');
    return row;
  }
}
