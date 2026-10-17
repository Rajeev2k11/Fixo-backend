import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  type AdminAccessResponse,
  type AdminLogin,
  type AdminLoginResponse,
  adminLoginSchema,
  type AdminMfa,
  adminMfaSchema,
  type AdminSessionResponse,
  ErrorCode,
} from '@fixo/contracts';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

import { AppError } from '../../common/app-error.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { ADMIN_SESSION_MAX_HOURS } from './auth.config.js';
import { Public } from './auth.guard.js';
import { SessionsService } from './sessions.service.js';

// The admin web app keeps the access token in memory; the refresh token never reaches JavaScript.
export const REFRESH_COOKIE = 'fixo_admin_rt';
export const DEVICE_COOKIE = 'fixo_admin_device';
// Double-submit CSRF: readable by the admin app, which echoes it in X-CSRF-Token. A forged
// cross-site request carries the cookies but cannot read this value to set the header.
export const CSRF_COOKIE = 'fixo_csrf';

const AUTH_PATH = '/v1/admin/auth';

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function checkCsrf(req: Request): void {
  const cookie = readCookie(req, CSRF_COOKIE) ?? '';
  const header = req.header('x-csrf-token') ?? '';
  const same =
    cookie.length > 0 &&
    cookie.length === header.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  if (!same) throw new AppError(ErrorCode.CSRF_FAILED, 403, 'Missing or wrong X-CSRF-Token');
}

@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLogin,
  ): Promise<AdminLoginResponse> {
    return this.adminAuth.login(body.email, body.password);
  }

  @Post('mfa')
  @HttpCode(200)
  async mfa(
    @Body(new ZodValidationPipe(adminMfaSchema)) body: AdminMfa,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionResponse> {
    const { refreshToken, deviceInstallId, ...session } = await this.adminAuth.completeMfa(
      body.mfaToken,
      body.code,
    );
    const options = await this.cookieOptions();
    res.cookie(REFRESH_COOKIE, refreshToken, { ...options, httpOnly: true, path: AUTH_PATH });
    res.cookie(DEVICE_COOKIE, deviceInstallId, { ...options, httpOnly: true, path: AUTH_PATH });
    res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), { ...options, path: '/' });
    return session;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAccessResponse> {
    checkCsrf(req);
    const tokens = await this.sessions.refresh(
      readCookie(req, REFRESH_COOKIE) ?? '',
      readCookie(req, DEVICE_COOKIE) ?? '',
    );
    const options = await this.cookieOptions();
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...options,
      httpOnly: true,
      path: AUTH_PATH,
    });
    return { accessToken: tokens.accessToken, accessTokenExpiresIn: tokens.accessTokenExpiresIn };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    checkCsrf(req);
    const refreshToken = readCookie(req, REFRESH_COOKIE);
    if (refreshToken) await this.sessions.logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: AUTH_PATH });
    res.clearCookie(DEVICE_COOKIE, { path: AUTH_PATH });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  /** Secure + SameSite=Strict; cookies live as long as the longest possible admin session. */
  private async cookieOptions(): Promise<CookieOptions> {
    const { value: maxHours } = await this.config.resolve(ADMIN_SESSION_MAX_HOURS);
    return { secure: true, sameSite: 'strict', maxAge: maxHours * 3_600_000 };
  }
}
