import { Module } from '@nestjs/common';

import { GeoRepository } from './geo.repository.js';
import { GeoService } from './geo.service.js';

@Module({
  providers: [GeoService, GeoRepository],
  exports: [GeoService],
})
export class GeoModule {}
