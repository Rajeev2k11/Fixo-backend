import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { SmsQueueModule } from '../../platform/sms/sms.js';
import { ConfigModule } from '../config/config.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminsController } from './admins.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

/** Login and sessions (spec §M): phone OTP for the apps, email + password + MFA for admins. */
@Module({
  imports: [ConfigModule, UsersModule, SmsQueueModule],
  controllers: [AuthController, AdminAuthController, AdminsController],
  providers: [
    AuthService,
    AdminAuthService,
    SessionsService,
    AuthRepository,
    RateLimiter,
    // Every route in the app requires a valid access token unless marked @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AdminAuthService],
})
export class AuthModule {}
