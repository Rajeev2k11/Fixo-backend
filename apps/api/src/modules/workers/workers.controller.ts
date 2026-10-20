import {
  type AcceptAgreement,
  acceptAgreementSchema,
  type UpdateWorkerProfile,
  updateWorkerProfileSchema,
  type WorkerProfile,
} from '@fixo/contracts';
import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AppRole, CurrentAuth } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/sessions.service.js';
import { WorkersService } from './workers.service.js';

/** Spec §L /workers: the worker app's own profile. */
@AppRole('worker')
@Controller('workers/me')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext): Promise<WorkerProfile> {
    return this.workers.me(auth.userId);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateWorkerProfileSchema)) body: UpdateWorkerProfile,
  ): Promise<WorkerProfile> {
    return this.workers.update(auth.userId, body);
  }

  @Post('agreement')
  @HttpCode(200)
  acceptAgreement(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(acceptAgreementSchema)) body: AcceptAgreement,
  ): Promise<WorkerProfile> {
    return this.workers.acceptAgreement(auth.userId, body.version);
  }
}
