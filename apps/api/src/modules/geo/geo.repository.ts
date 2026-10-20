import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../../common/db.js';
import { city } from './geo.schema.js';

/** The only code that reads or writes the geography tables. */
@Injectable()
export class GeoRepository {
  async findActiveCity(db: Db, id: string): Promise<{ id: string; name: string } | undefined> {
    const [row] = await db
      .select({ id: city.id, name: city.name })
      .from(city)
      .where(and(eq(city.id, id), eq(city.isActive, true)));
    return row;
  }
}
