import { Module } from '@nestjs/common';

import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { SmsQueueModule } from '../../platform/sms/sms.js';
import { ConfigModule } from '../config/config.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

/** Login (spec §M). OTP now; sessions and tokens in step 1.10, admin login in 1.11. */
@Module({
  imports: [ConfigModule, UsersModule, SmsQueueModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, RateLimiter],
})
export class AuthModule {}
