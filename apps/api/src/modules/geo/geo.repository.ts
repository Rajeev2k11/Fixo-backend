import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import { area, city } from './geo.schema.js';

type Executor = Db | Tx;

/** The only code that reads or writes the geography tables. */
@Injectable()
export class GeoRepository {
  async findActiveCity(
    db: Executor,
    id: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const [row] = await db
      .select({ id: city.id, name: city.name })
      .from(city)
      .where(and(eq(city.id, id), eq(city.isActive, true)));
    return row;
  }

  listActiveCities(db: Executor): Promise<{ id: string; name: string }[]> {
    return db
      .select({ id: city.id, name: city.name })
      .from(city)
      .where(eq(city.isActive, true))
      .orderBy(asc(city.name));
  }

  listActiveAreas(
    db: Executor,
    cityId: string,
  ): Promise<{ id: string; cityId: string; name: string }[]> {
    return db
      .select({ id: area.id, cityId: area.cityId, name: area.name })
      .from(area)
      .where(and(eq(area.cityId, cityId), eq(area.isActive, true)))
      .orderBy(asc(area.name));
  }

  /** The ids among `ids` that are active areas of `cityId`. */
  async activeAreaIdsInCity(db: Executor, cityId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: area.id })
      .from(area)
      .where(and(inArray(area.id, ids), eq(area.cityId, cityId), eq(area.isActive, true)));
    return rows.map((r) => r.id);
  }

  async insertArea(tx: Tx, values: typeof area.$inferInsert): Promise<typeof area.$inferSelect> {
    const [row] = await tx.insert(area).values(values).returning();
    if (!row) throw new Error('area insert returned no row');
    return row;
  }
}
