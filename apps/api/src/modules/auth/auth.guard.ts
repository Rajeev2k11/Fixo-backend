import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ErrorCode } from '@fixo/contracts';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { UsersService } from '../users/users.service.js';
import { type AuthContext, SessionsService } from './sessions.service.js';

declare module 'express' {
  interface Request {
    auth?: AuthContext;
    /** Set on @AdminOnly routes: the admin, with all their role codes, for audit rows. */
    admin?: Actor;
  }
}

const PUBLIC = Symbol('PUBLIC');
const ADMIN_ROLES = Symbol('ADMIN_ROLES');

/** Opts a controller or route out of authentication. Everything else requires a valid token. */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC, true);

/**
 * Restricts a controller or route to admin sessions holding one of `roles` (none listed = any
 * admin role). Spec §M layer 1 (RBAC); finer rules, like which config keys a role may change,
 * live in the owning service.
 */
export const AdminOnly = (...roles: string[]): ClassDecorator & MethodDecorator =>
  SetMetadata(ADMIN_ROLES, roles);

/** The admin making the request (from @AdminOnly routes), as an Actor for audit and checks. */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const admin = ctx.switchToHttp().getRequest<Request>().admin;
  if (!admin) throw new Error('CurrentAdmin used without @AdminOnly');
  return admin;
});

/** The authenticated caller, e.g. `@CurrentAuth() auth: AuthContext`. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new Error('CurrentAuth used on a @Public route');
  return auth;
});

/** Global guard: authentication (secure by default) plus admin role checks (spec §L rule 2). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    const auth = await this.sessions.authenticate(scheme === 'Bearer' && token ? token : '');
    req.auth = auth;

    const allowed = this.reflector.getAllAndOverride<string[] | undefined>(ADMIN_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      // A customer or worker token never reaches an admin route, whatever roles the user holds.
      const held = auth.role === 'admin' ? await this.users.adminRoleCodes(auth.userId) : [];
      const permitted =
        held.length > 0 && (allowed.length === 0 || held.some((r) => allowed.includes(r)));
      if (!permitted) throw new AppError(ErrorCode.FORBIDDEN, 403, 'Your role cannot do this');
      req.admin = { userId: auth.userId, role: held.join(',') };
    }
    return true;
  }
}
