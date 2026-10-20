import { type WorkerOnboarding, workerOnboardingSchema, type WorkerProfile } from '@fixo/contracts';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AppRole, CurrentAuth } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/sessions.service.js';
import { WorkersService } from './workers.service.js';

/** Spec §L /workers: the worker app's own profile and its onboarding submission. */
@AppRole('worker')
@Controller('workers/me')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext): Promise<WorkerProfile> {
    return this.workers.me(auth.userId);
  }

  /** All onboarding steps at once; also used to resubmit after being sent back. */
  @Post('onboarding')
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(workerOnboardingSchema)) body: WorkerOnboarding,
  ): Promise<WorkerProfile> {
    return this.workers.submit(auth.userId, body);
  }
}
