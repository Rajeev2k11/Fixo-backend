import { randomBytes, randomUUID } from 'node:crypto';

import {
  type AdminLoginResponse,
  type AdminSessionResponse,
  ErrorCode,
  type TokenPair,
} from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

import type { Actor } from '../../common/actor.js';
import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { env } from '../../common/env.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { ConfigService } from '../config/config.service.js';
import { UsersService } from '../users/users.service.js';
import {
  ADMIN_LOCKOUT_MINUTES,
  ADMIN_MAX_PASSWORD_FAILURES,
  ADMIN_MFA_MAX_ATTEMPTS,
  ADMIN_PASSWORD_MIN_LENGTH,
} from './auth.config.js';
import { AuthRepository } from './auth.repository.js';
import { decrypt, encrypt, hashPassword, verifyPassword } from './domain/secrets.js';
import { generateTotpSecret, matchTotp, otpauthUrl } from './domain/totp.js';
import { SessionsService } from './sessions.service.js';

const JWT_KEY = new TextEncoder().encode(env.JWT_SECRET);
const MFA_AUDIENCE = 'fixo-admin-mfa';
const MFA_TOKEN_SECONDS = 300;
const ISSUER_LABEL = 'FIXO Admin';

// Same message for unknown email, wrong password and locked account: nothing to enumerate.
const invalidCredentials = () =>
  new AppError(ErrorCode.INVALID_CREDENTIALS, 401, 'Invalid email or password');
const invalidMfa = (message = 'The code is incorrect') =>
  new AppError(ErrorCode.MFA_INVALID, 401, message);
const restricted = () =>
  new AppError(ErrorCode.ACCOUNT_RESTRICTED, 403, 'This account is suspended or blocked');

// Verified against when there is no real hash, so every failure costs the same scrypt time.
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

export interface AdminSession extends AdminSessionResponse {
  refreshToken: string;
  deviceInstallId: string;
}

/** Admin login (spec §M): email + password, then mandatory TOTP MFA, then a short session. */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: AuthRepository,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Bootstraps an admin (CLI). Returns a generated password, shown once, so it never passes
   * through shell history or chat.
   */
  async createAdmin(input: {
    email: string;
    displayName: string;
    roleCodes: string[];
    actor: Actor;
    reason: string;
  }): Promise<{ userId: string; password: string }> {
    const { value: minLength } = await this.config.resolve(ADMIN_PASSWORD_MIN_LENGTH);
    const password = randomBytes(24).toString('base64url'); // 32 characters
    if (password.length < minLength) throw new Error('generated password is below the minimum');
    const userId = await this.users.createAdmin(input);
    const passwordHash = await hashPassword(password);
    await this.db.transaction((tx) => this.repo.insertAdminCredential(tx, userId, passwordHash));
    return { userId, password };
  }

  /** Step 1: password. Returns a 5-minute MFA token, plus a new TOTP secret on first login. */
  async login(email: string, password: string): Promise<AdminLoginResponse> {
    const [{ value: maxFailures }, { value: lockMinutes }] = await Promise.all([
      this.config.resolve(ADMIN_MAX_PASSWORD_FAILURES),
      this.config.resolve(ADMIN_LOCKOUT_MINUTES),
    ]);
    const userId = await this.users.findUserIdByEmail(email);
    if (!userId) {
      await verifyPassword(password, await dummyHash);
      throw invalidCredentials();
    }

    // Failures are committed before the error is thrown, so the lockout counter adds up.
    const outcome = await this.db.transaction(async (tx) => {
      const credential = await this.repo.lockAdminCredential(tx, userId);
      const locked = credential?.lockedUntil && credential.lockedUntil > new Date();
      if (!credential || locked) {
        await verifyPassword(password, await dummyHash);
        return { result: 'invalid' as const };
      }
      if (!(await verifyPassword(password, credential.passwordHash))) {
        const failures = credential.failedPasswordAttempts + 1;
        const lockNow = failures >= maxFailures;
        await this.repo.setPasswordFailures(
          tx,
          credential.id,
          lockNow ? 0 : failures,
          lockNow ? new Date(Date.now() + lockMinutes * 60_000) : null,
        );
        return { result: 'invalid' as const };
      }
      await this.repo.setPasswordFailures(tx, credential.id, 0, null);
      if (credential.mfaEnrolledAt) return { result: 'verify' as const };
      // Not enrolled yet: (re)issue a secret; enrolment completes with the first valid code.
      const secret = generateTotpSecret();
      await this.repo.setPendingTotpSecret(
        tx,
        credential.id,
        encrypt(secret, env.MFA_ENCRYPTION_KEY),
      );
      return { result: 'enroll' as const, secret };
    });

    if (outcome.result === 'invalid') throw invalidCredentials();
    if ((await this.users.getStatus(userId)) !== 'active') throw restricted();
    const mfaToken = await this.signMfaToken(userId);
    if (outcome.result === 'verify') return { stage: 'verify', mfaToken };
    return {
      stage: 'enroll',
      mfaToken,
      secret: outcome.secret,
      otpauthUrl: otpauthUrl(ISSUER_LABEL, email.trim().toLowerCase(), outcome.secret),
    };
  }

  /** Step 2: TOTP code. Only now is a session created (MFA is mandatory, spec §M). */
  async completeMfa(mfaToken: string, code: string): Promise<AdminSession> {
    const { userId, jti } = await this.verifyMfaToken(mfaToken);
    const { value: maxAttempts } = await this.config.resolve(ADMIN_MFA_MAX_ATTEMPTS);
    const attempt = await this.limiter.hit(`admin-mfa:${jti}`, maxAttempts, MFA_TOKEN_SECONDS);
    if (!attempt.allowed) throw invalidMfa('Too many wrong codes. Log in again.');

    const accepted = await this.db.transaction(async (tx) => {
      const credential = await this.repo.lockAdminCredential(tx, userId);
      if (!credential?.totpSecretEncrypted) return false;
      const secret = decrypt(credential.totpSecretEncrypted, env.MFA_ENCRYPTION_KEY);
      const step = matchTotp(secret, code, Date.now());
      const replayed =
        step !== null && credential.lastTotpStep !== null && step <= credential.lastTotpStep;
      if (step === null || replayed) return false;
      await this.repo.acceptTotp(tx, credential.id, step, credential.mfaEnrolledAt === null);
      return true;
    });
    if (!accepted) throw invalidMfa();
    if ((await this.users.getStatus(userId)) !== 'active') throw restricted();

    const deviceInstallId = randomUUID(); // the browser is bound via an httpOnly cookie
    const tokens: TokenPair = await this.sessions.start(userId, 'admin', deviceInstallId);
    return {
      userId,
      adminRoles: await this.users.adminRoleCodes(userId),
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      refreshToken: tokens.refreshToken,
      deviceInstallId,
    };
  }

  private signMfaToken(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(randomUUID())
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${String(MFA_TOKEN_SECONDS)}s`)
      .sign(JWT_KEY);
  }

  private async verifyMfaToken(token: string): Promise<{ userId: string; jti: string }> {
    try {
      const { payload } = await jwtVerify(token, JWT_KEY, {
        audience: MFA_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub || !payload.jti) throw new Error('incomplete MFA token');
      return { userId: payload.sub, jti: payload.jti };
    } catch {
      throw invalidMfa('This login attempt has expired. Log in again.');
    }
  }
}
