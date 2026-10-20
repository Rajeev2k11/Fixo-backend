import { Inject, Injectable } from '@nestjs/common';

import { DB, type Db } from '../../common/db.js';
import { GeoRepository } from './geo.repository.js';

/** Geography (spec §A). Areas, zones and coordinate resolution arrive in Phase 3. */
@Injectable()
export class GeoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: GeoRepository,
  ) {}

  /** The city if it exists and is open for service; undefined otherwise. */
  findActiveCity(id: string): Promise<{ id: string; name: string } | undefined> {
    return this.repo.findActiveCity(this.db, id);
  }
}
