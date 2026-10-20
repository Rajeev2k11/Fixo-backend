import { Module } from '@nestjs/common';

import { CatalogueController } from './catalogue.controller.js';
import { CatalogueRepository } from './catalogue.repository.js';
import { CatalogueService } from './catalogue.service.js';

@Module({
  controllers: [CatalogueController],
  providers: [CatalogueService, CatalogueRepository],
  exports: [CatalogueService],
})
export class CatalogueModule {}
