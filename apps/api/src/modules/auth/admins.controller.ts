import {
  type CreateAdmin,
  type CreateAdminResponse,
  createAdminSchema,
  type SetAdminRoles,
  setAdminRolesSchema,
} from '@fixo/contracts';
import { Body, Controller, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import type { Actor } from '../../common/actor.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { UsersService } from '../users/users.service.js';
import { AdminOnly, CurrentAdmin } from './auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';

/** Spec §Y module 21: only super admins create admins and assign roles. Every change is audited. */
@AdminOnly('super_admin')
@Controller('admin/admins')
export class AdminsController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly users: UsersService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store') // the response carries a one-time password
  async create(
    @Body(new ZodValidationPipe(createAdminSchema)) body: CreateAdmin,
    @CurrentAdmin() admin: Actor,
  ): Promise<CreateAdminResponse> {
    const { userId, password } = await this.adminAuth.createAdmin({
      email: body.email,
      displayName: body.displayName,
      roleCodes: body.roleCodes,
      actor: admin,
      reason: body.reason,
    });
    return { userId, oneTimePassword: password };
  }

  @Put(':userId/roles')
  @HttpCode(204)
  async setRoles(
    @Param('userId', new ZodValidationPipe(z.uuid())) userId: string,
    @Body(new ZodValidationPipe(setAdminRolesSchema)) body: SetAdminRoles,
    @CurrentAdmin() admin: Actor,
  ): Promise<void> {
    await this.users.setAdminRoles({
      userId,
      roleCodes: body.roleCodes,
      actor: admin,
      reason: body.reason,
    });
  }
}
