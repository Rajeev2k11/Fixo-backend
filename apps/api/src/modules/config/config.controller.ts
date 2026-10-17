import {
  type DecideConfig,
  decideConfigSchema,
  type ListConfigQuery,
  listConfigQuerySchema,
  type ProposeConfig,
  proposeConfigSchema,
} from '@fixo/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import type { Actor } from '../../common/actor.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminOnly, CurrentAdmin } from '../auth/auth.guard.js';
import type { ConfigRuleRow } from './config.schema.js';
import { ConfigService } from './config.service.js';

const idPipe = new ZodValidationPipe(z.uuid());
const requestIdOf = (req: Request) => (typeof req.id === 'string' ? req.id : undefined);

/**
 * Spec §Y modules 9-11. Route guards admit the roles that can ever act here; ConfigService then
 * checks the key's own policy (e.g. only finance approves revenue rules) and maker-checker.
 */
@Controller('admin/config/rules')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @AdminOnly('super_admin', 'operations', 'finance')
  list(
    @Query(new ZodValidationPipe(listConfigQuerySchema)) query: ListConfigQuery,
  ): Promise<ConfigRuleRow[]> {
    return this.config.list(query);
  }

  @Post()
  @AdminOnly('super_admin', 'operations')
  propose(
    @Body(new ZodValidationPipe(proposeConfigSchema)) body: ProposeConfig,
    @CurrentAdmin() admin: Actor,
    @Req() req: Request,
  ): Promise<ConfigRuleRow> {
    return this.config.propose({
      key: body.key,
      scope: body.scope,
      value: body.value,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      reason: body.reason,
      actor: admin,
      requestId: requestIdOf(req),
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @AdminOnly('finance', 'super_admin')
  approve(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(decideConfigSchema)) body: DecideConfig,
    @CurrentAdmin() admin: Actor,
    @Req() req: Request,
  ): Promise<ConfigRuleRow> {
    return this.config.approve(id, admin, body.reason, requestIdOf(req));
  }

  /** Any admin may withdraw their own proposal; otherwise approver roles only (checked in service). */
  @Post(':id/reject')
  @HttpCode(200)
  @AdminOnly()
  reject(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(decideConfigSchema)) body: DecideConfig,
    @CurrentAdmin() admin: Actor,
    @Req() req: Request,
  ): Promise<ConfigRuleRow> {
    return this.config.reject(id, admin, body.reason, requestIdOf(req));
  }
}
