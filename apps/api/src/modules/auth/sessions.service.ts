import { createHash, randomBytes } from 'node:crypto';

import { ErrorCode, type TokenPair } from '@fixo/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

import { AppError } from '../../common/app-error.js';
import { DB, type Db, type Tx } from '../../common/db.js';
import { env } from '../../common/env.js';
import { ConfigService } from '../config/config.service.js';
import { type AppRole, UsersService } from '../users/users.service.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ADMIN_SESSION_IDLE_MINUTES,
  ADMIN_SESSION_MAX_HOURS,
  SESSION_IDLE_DAYS,
  SESSION_MAX_DAYS,
} from './auth.config.js';
import { AuthRepository } from './auth.repository.js';
import type { SessionRow } from './auth.schema.js';

/** Who a request acts as, from a verified access token. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  role: AppRole;
}

const JWT_KEY = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'fixo-api';
const AUDIENCE = 'fixo-app';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const unauthenticated = () =>
  new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Log in or refresh your access token');
const sessionExpired = () =>
  new AppError(ErrorCode.SESSION_EXPIRED, 401, 'Your session has ended. Please log in again.');
const restricted = () =>
  new AppError(ErrorCode.ACCOUNT_RESTRICTED, 403, 'This account is suspended or blocked');

type RefreshOutcome =
  | { ok: true; session: SessionRow; refreshToken: string }
  | { ok: false; error: 'expired' | 'restricted' };

/**
 * Sessions and tokens (spec §M): a 15-minute JWT access token plus a single-use refresh token
 * bound to the device. Refresh tokens are 256 random bits, so a plain SHA-256 is enough to store.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: AuthRepository,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async start(userId: string, role: AppRole, deviceInstallId: string): Promise<TokenPair> {
    const { idleMs, maxMs } = await this.lifetime(role);
    const now = Date.now();
    const { session, refreshToken } = await this.db.transaction(async (tx) => {
      const created = await this.repo.createSession(tx, {
        userId,
        deviceInstallId,
        activeRole: role,
        idleExpiresAt: new Date(now + idleMs),
        absoluteExpiresAt: new Date(now + maxMs),
      });
      return { session: created, refreshToken: await this.issueRefreshToken(tx, created.id) };
    });
    return this.tokenPair(session, refreshToken);
  }

  /**
   * Rotates a refresh token. A token presented twice means it was copied: the whole session is
   * revoked (spec §M), so the thief's copy and the owner's both stop working. Revocations are
   * committed before the error is returned.
   */
  async refresh(presented: string, deviceInstallId: string): Promise<TokenPair> {
    const outcome = await this.db.transaction(async (tx): Promise<RefreshOutcome> => {
      const found = await this.repo.lockRefreshToken(tx, sha256(presented));
      if (!found || found.session.revokedAt) return { ok: false, error: 'expired' };
      const { session } = found;

      const end = async (reason: string, error: 'expired' | 'restricted' = 'expired') => {
        await this.repo.revokeSession(tx, session.id, reason);
        return { ok: false, error } as const;
      };
      // ponytail: no grace period, so two parallel refreshes from one app also trip this.
      // Clients must serialise refresh; add a few-second grace window if real apps hit it.
      if (found.usedAt) {
        this.logger.warn(`Refresh token reuse; session ${session.id} revoked`);
        return end('refresh_token_reuse');
      }
      if (session.deviceInstallId !== deviceInstallId) return end('device_mismatch');
      const now = new Date();
      if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) return end('expired');
      if ((await this.users.getStatus(session.userId)) !== 'active') {
        return end('account_restricted', 'restricted');
      }

      await this.repo.markRefreshTokenUsed(tx, found.tokenId);
      const { idleMs } = await this.lifetime(session.activeRole);
      const idle = Math.min(now.getTime() + idleMs, session.absoluteExpiresAt.getTime());
      await this.repo.extendSession(tx, session.id, new Date(idle));
      return { ok: true, session, refreshToken: await this.issueRefreshToken(tx, session.id) };
    });

    if (!outcome.ok) throw outcome.error === 'restricted' ? restricted() : sessionExpired();
    return this.tokenPair(outcome.session, outcome.refreshToken);
  }

  /** Ends the session the token belongs to. Unknown tokens are ignored (nothing to reveal). */
  async logout(presented: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const found = await this.repo.lockRefreshToken(tx, sha256(presented));
      if (found) await this.repo.revokeSession(tx, found.session.id, 'logout');
    });
  }

  /**
   * Verifies an access token and that its session and account are still in good standing, so a
   * logout, revocation or suspension takes effect on the very next request (spec §M, §N).
   * ponytail: two indexed lookups per request; cache session status in Redis if this gets hot.
   */
  async authenticate(accessToken: string): Promise<AuthContext> {
    let claims: { sub?: string; sid?: unknown; role?: unknown };
    try {
      ({ payload: claims } = await jwtVerify(accessToken, JWT_KEY, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      }));
    } catch {
      throw unauthenticated();
    }
    const { sub, sid, role } = claims;
    if (!sub || typeof sid !== 'string' || typeof role !== 'string') throw unauthenticated();

    const session = await this.repo.findLiveSession(this.db, sid);
    if (!session) throw unauthenticated();
    if ((await this.users.getStatus(sub)) !== 'active') throw restricted();
    return { userId: sub, sessionId: sid, role: session.activeRole };
  }

  /** App sessions last days (AUTH-1); admin sessions minutes and hours (AUTH-2). */
  private async lifetime(role: AppRole): Promise<{ idleMs: number; maxMs: number }> {
    if (role === 'admin') {
      const [idle, max] = await Promise.all([
        this.config.resolve(ADMIN_SESSION_IDLE_MINUTES),
        this.config.resolve(ADMIN_SESSION_MAX_HOURS),
      ]);
      return { idleMs: idle.value * MINUTE_MS, maxMs: max.value * HOUR_MS };
    }
    const [idle, max] = await Promise.all([
      this.config.resolve(SESSION_IDLE_DAYS),
      this.config.resolve(SESSION_MAX_DAYS),
    ]);
    return { idleMs: idle.value * DAY_MS, maxMs: max.value * DAY_MS };
  }

  private async issueRefreshToken(tx: Tx, sessionId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.repo.insertRefreshToken(tx, sessionId, sha256(token));
    return token;
  }

  private async tokenPair(session: SessionRow, refreshToken: string): Promise<TokenPair> {
    const { value: ttl } = await this.config.resolve(ACCESS_TOKEN_TTL_SECONDS);
    const accessToken = await new SignJWT({ sid: session.id, role: session.activeRole })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${String(ttl)}s`)
      .sign(JWT_KEY);
    return { accessToken, accessTokenExpiresIn: ttl, refreshToken };
  }
}
