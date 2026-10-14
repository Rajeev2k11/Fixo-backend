import { Module } from '@nestjs/common';

import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/** Users, identities, role profiles and account status (spec §X: users module). */
@Module({
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
