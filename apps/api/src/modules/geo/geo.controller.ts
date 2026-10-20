import {
  type Area,
  type AreasQuery,
  areasQuerySchema,
  type City,
  type CreateArea,
  createAreaSchema,
} from '@fixo/contracts';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import type { Actor } from '../../common/actor.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminOnly, CurrentAdmin, Public } from '../auth/auth.guard.js';
import { GeoService } from './geo.service.js';

/** Spec §L /areas: public pickers for the apps, plus admin setup (spec §Y module 8). */
@Controller()
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Get('cities')
  cities(): Promise<City[]> {
    return this.geo.listActiveCities();
  }

  @Public()
  @Get('areas')
  areas(@Query(new ZodValidationPipe(areasQuerySchema)) query: AreasQuery): Promise<Area[]> {
    return this.geo.listActiveAreas(query.cityId);
  }

  @AdminOnly('super_admin', 'operations')
  @Post('admin/geo/areas')
  createArea(
    @Body(new ZodValidationPipe(createAreaSchema)) body: CreateArea,
    @CurrentAdmin() admin: Actor,
  ): Promise<Area> {
    return this.geo.createArea(body, admin);
  }
}
