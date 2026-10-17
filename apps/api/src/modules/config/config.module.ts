import { Module } from '@nestjs/common';

import { ConfigController } from './config.controller.js';
import { ConfigRepository } from './config.repository.js';
import { ConfigService } from './config.service.js';

/** Versioned business configuration (CLAUDE.md rule 7). Other modules use ConfigService only. */
@Module({
  controllers: [ConfigController],
  providers: [ConfigService, ConfigRepository],
  exports: [ConfigService],
})
export class ConfigModule {}
