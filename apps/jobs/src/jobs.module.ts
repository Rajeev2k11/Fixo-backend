import { Module } from '@nestjs/common';

/**
 * Root module for the background worker process. Queue consumers, the outbox
 * relay and sweepers are registered here from step 1.4 onwards.
 */
@Module({})
export class JobsModule {}
