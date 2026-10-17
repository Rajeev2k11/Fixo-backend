import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import {
  adminCredential,
  type AdminCredentialRow,
  otpChallenge,
  type OtpChallengeRow,
  refreshToken,
  session,
  type SessionRow,
} from './auth.schema.js';

/** The only code that reads or writes the auth module's tables. */
@Injectable()
export class AuthRepository {
  /** Creates a challenge and retires any older open one, so only the latest code works. */
  async replaceChallenge(
    tx: Tx,
    phoneHash: string,
    codeHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await tx
      .update(otpChallenge)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpChallenge.phoneHash, phoneHash), isNull(otpChallenge.consumedAt)));
    await tx.insert(otpChallenge).values({ phoneHash, codeHash, expiresAt });
  }

  async lockOpenChallenge(tx: Tx, phoneHash: string): Promise<OtpChallengeRow | undefined> {
    const [row] = await tx
      .select()
      .from(otpChallenge)
      .where(
        and(
          eq(otpChallenge.phoneHash, phoneHash),
          isNull(otpChallenge.consumedAt),
          gt(otpChallenge.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(otpChallenge.createdAt))
      .limit(1)
      .for('update');
    return row;
  }

  async recordFailedAttempt(tx: Tx, id: string): Promise<void> {
    await tx
      .update(otpChallenge)
      .set({ attempts: sql`${otpChallenge.attempts} + 1` })
      .where(eq(otpChallenge.id, id));
  }

  async consume(tx: Tx, id: string): Promise<void> {
    await tx
      .update(otpChallenge)
      .set({ consumedAt: sql`now()` })
      .where(eq(otpChallenge.id, id));
  }

  async createSession(tx: Tx, values: typeof session.$inferInsert): Promise<SessionRow> {
    const [row] = await tx.insert(session).values(values).returning();
    if (!row) throw new Error('session insert returned no row');
    return row;
  }

  async insertRefreshToken(tx: Tx, sessionId: string, tokenHash: string): Promise<void> {
    await tx.insert(refreshToken).values({ sessionId, tokenHash });
  }

  /** The token and its session, both locked, so concurrent refreshes of one token serialise. */
  async lockRefreshToken(
    tx: Tx,
    tokenHash: string,
  ): Promise<{ tokenId: string; usedAt: Date | null; session: SessionRow } | undefined> {
    const [row] = await tx
      .select({ tokenId: refreshToken.id, usedAt: refreshToken.usedAt, session })
      .from(refreshToken)
      .innerJoin(session, eq(session.id, refreshToken.sessionId))
      .where(eq(refreshToken.tokenHash, tokenHash))
      .for('update');
    return row;
  }

  async markRefreshTokenUsed(tx: Tx, tokenId: string): Promise<void> {
    await tx
      .update(refreshToken)
      .set({ usedAt: sql`now()` })
      .where(eq(refreshToken.id, tokenId));
  }

  async extendSession(tx: Tx, sessionId: string, idleExpiresAt: Date): Promise<void> {
    await tx.update(session).set({ idleExpiresAt }).where(eq(session.id, sessionId));
  }

  async revokeSession(tx: Tx, sessionId: string, reason: string): Promise<void> {
    await tx
      .update(session)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(session.id, sessionId), isNull(session.revokedAt)));
  }

  async revokeAllSessions(tx: Tx, userId: string, reason: string): Promise<void> {
    await tx
      .update(session)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(session.userId, userId), isNull(session.revokedAt)));
  }

  /** A session that can still back an access token: not revoked and within its maximum life. */
  async findLiveSession(db: Db | Tx, sessionId: string): Promise<SessionRow | undefined> {
    const [row] = await db
      .select()
      .from(session)
      .where(
        and(
          eq(session.id, sessionId),
          isNull(session.revokedAt),
          gt(session.absoluteExpiresAt, sql`now()`),
        ),
      );
    return row;
  }

  async insertAdminCredential(tx: Tx, userId: string, passwordHash: string): Promise<void> {
    await tx.insert(adminCredential).values({ userId, passwordHash });
  }

  async lockAdminCredential(tx: Tx, userId: string): Promise<AdminCredentialRow | undefined> {
    const [row] = await tx
      .select()
      .from(adminCredential)
      .where(eq(adminCredential.userId, userId))
      .for('update');
    return row;
  }

  async setPasswordFailures(
    tx: Tx,
    id: string,
    failedPasswordAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await tx
      .update(adminCredential)
      .set({ failedPasswordAttempts, lockedUntil, updatedAt: new Date() })
      .where(eq(adminCredential.id, id));
  }

  async setPendingTotpSecret(tx: Tx, id: string, totpSecretEncrypted: string): Promise<void> {
    await tx
      .update(adminCredential)
      .set({ totpSecretEncrypted, updatedAt: new Date() })
      .where(and(eq(adminCredential.id, id), isNull(adminCredential.mfaEnrolledAt)));
  }

  /** Records the accepted code's step (anti-replay) and completes enrolment if pending. */
  async acceptTotp(tx: Tx, id: string, step: number, completesEnrolment: boolean): Promise<void> {
    await tx
      .update(adminCredential)
      .set({
        lastTotpStep: step,
        ...(completesEnrolment && { mfaEnrolledAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(adminCredential.id, id));
  }
}
