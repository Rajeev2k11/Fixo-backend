import { Module } from '@nestjs/common';

import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { WorkerProfileService } from './worker-profile.service.js';

/** Users, identities, role profiles and account status (spec §X: users module). */
@Module({
  providers: [UsersService, WorkerProfileService, UsersRepository],
  exports: [UsersService, WorkerProfileService],
})
export class UsersModule {}
