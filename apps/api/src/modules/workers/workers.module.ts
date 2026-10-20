import { Module } from '@nestjs/common';

import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { ConfigModule } from '../config/config.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorkersController } from './workers.controller.js';
import { WorkersRepository } from './workers.repository.js';
import { WorkersService } from './workers.service.js';

/** Worker onboarding and capability (spec §C, §K): areas, services, availability, KYC files. */
@Module({
  imports: [UsersModule, MediaModule, GeoModule, CatalogueModule, ConfigModule],
  controllers: [WorkersController],
  providers: [WorkersService, WorkersRepository],
})
export class WorkersModule {}
