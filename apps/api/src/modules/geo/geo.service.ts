import type { Area, City, CreateArea } from '@fixo/contracts';
import { ErrorCode } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { slugify, uniqueViolation } from '../../common/sql-errors.js';
import { recordAudit } from '../../platform/audit/audit.js';
import { GeoRepository } from './geo.repository.js';

/** Geography (spec §A). Polygons, zones and coordinate resolution arrive in Phase 3. */
@Injectable()
export class GeoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: GeoRepository,
  ) {}

  /** The city if it exists and is open for service; undefined otherwise. */
  findActiveCity(id: string): Promise<City | undefined> {
    return this.repo.findActiveCity(this.db, id);
  }

  listActiveCities(): Promise<City[]> {
    return this.repo.listActiveCities(this.db);
  }

  listActiveAreas(cityId: string): Promise<Area[]> {
    return this.repo.listActiveAreas(this.db, cityId);
  }

  /** The ids in `ids` that are not active areas of `cityId` (for validation messages). */
  async invalidAreaIds(cityId: string, ids: string[]): Promise<string[]> {
    const valid = new Set(await this.repo.activeAreaIdsInCity(this.db, cityId, ids));
    return ids.filter((id) => !valid.has(id));
  }

  /** Admin: adds an area to a city (decision REF-1: the real list is entered, not invented). */
  async createArea(input: CreateArea, actor: Actor): Promise<Area> {
    if (!(await this.findActiveCity(input.cityId))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Unknown or inactive city');
    }
    try {
      return await this.db.transaction(async (tx) => {
        const row = await this.repo.insertArea(tx, {
          cityId: input.cityId,
          name: input.name,
          slug: slugify(input.name),
        });
        await recordAudit(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'geo.area_created',
          entityType: 'area',
          entityId: row.id,
          before: null,
          after: { cityId: row.cityId, name: row.name },
          reason: input.reason,
        });
        return { id: row.id, cityId: row.cityId, name: row.name };
      });
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new AppError(
          ErrorCode.ALREADY_EXISTS,
          409,
          `${input.name} already exists in this city`,
        );
      }
      throw err;
    }
  }
}
