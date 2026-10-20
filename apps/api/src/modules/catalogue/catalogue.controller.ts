import {
  type CreateServiceCategory,
  createServiceCategorySchema,
  type ServiceCategory,
} from '@fixo/contracts';
import { Body, Controller, Get, Post } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminOnly, CurrentAdmin, Public } from '../auth/auth.guard.js';
import { CatalogueService } from './catalogue.service.js';

/** Spec §L /services (public, cached later) plus admin setup (spec §Y module 7). */
@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Public()
  @Get('services/categories')
  categories(): Promise<ServiceCategory[]> {
    return this.catalogue.listActiveCategories();
  }

  @AdminOnly('super_admin', 'operations')
  @Post('admin/catalogue/categories')
  create(
    @Body(new ZodValidationPipe(createServiceCategorySchema)) body: CreateServiceCategory,
    @CurrentAdmin() admin: Actor,
  ): Promise<ServiceCategory> {
    return this.catalogue.createCategory(body, admin);
  }
}
