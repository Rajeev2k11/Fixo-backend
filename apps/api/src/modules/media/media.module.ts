import { Module } from '@nestjs/common';

import { FakeMalwareScanner, MALWARE_SCANNER } from '../../platform/storage/malware-scanner.js';
import { StorageModule } from '../../platform/storage/storage.js';
import { ConfigModule } from '../config/config.module.js';
import { MediaController } from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';

/** Uploads, signed links and scanning (spec §X media module). */
@Module({
  imports: [ConfigModule, StorageModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaRepository,
    { provide: MALWARE_SCANNER, useClass: FakeMalwareScanner },
  ],
  exports: [MediaService],
})
export class MediaModule {}
