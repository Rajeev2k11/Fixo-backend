import { Module } from '@nestjs/common';

import { GeoController } from './geo.controller.js';
import { GeoRepository } from './geo.repository.js';
import { GeoService } from './geo.service.js';

@Module({
  controllers: [GeoController],
  providers: [GeoService, GeoRepository],
  exports: [GeoService],
})
export class GeoModule {}
