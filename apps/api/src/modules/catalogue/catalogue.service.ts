import { type CreateServiceCategory, ErrorCode, type ServiceCategory } from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { uniqueViolation } from '../../common/sql-errors.js';
import { recordAudit } from '../../platform/audit/audit.js';
import { CatalogueRepository } from './catalogue.repository.js';

/** Service catalogue (spec §K). Categories now; subcategories and problems in Phase 3. */
@Injectable()
export class CatalogueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CatalogueRepository,
  ) {}

  listActiveCategories(): Promise<ServiceCategory[]> {
    return this.repo.listActiveCategories(this.db);
  }

  /** The ids in `ids` that are not active categories (for validation messages). */
  async invalidCategoryIds(ids: string[]): Promise<string[]> {
    const valid = new Set(await this.repo.activeCategoryIds(this.db, ids));
    return ids.filter((id) => !valid.has(id));
  }

  /** Admin: adds a category (decision REF-1: the real list is entered, not invented). */
  async createCategory(input: CreateServiceCategory, actor: Actor): Promise<ServiceCategory> {
    try {
      return await this.db.transaction(async (tx) => {
        const row = await this.repo.insertCategory(tx, {
          slug: input.slug,
          name: input.name,
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        });
        await recordAudit(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'catalogue.category_created',
          entityType: 'service_category',
          entityId: row.id,
          before: null,
          after: { slug: row.slug, name: row.name },
          reason: input.reason,
        });
        return { id: row.id, slug: row.slug, name: row.name };
      });
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new AppError(ErrorCode.ALREADY_EXISTS, 409, `Category ${input.slug} already exists`);
      }
      throw err;
    }
  }
}
