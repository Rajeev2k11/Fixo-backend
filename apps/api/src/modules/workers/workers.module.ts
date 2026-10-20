import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorkersController } from './workers.controller.js';
import { WorkersService } from './workers.service.js';

/** Worker onboarding (spec §C). Areas, services and availability join in Phase 3. */
@Module({
  imports: [UsersModule, MediaModule, GeoModule, ConfigModule],
  controllers: [WorkersController],
  providers: [WorkersService],
})
export class WorkersModule {}
