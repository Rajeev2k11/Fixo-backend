import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import type { Tx } from '../../common/db.js';
import { otpChallenge, type OtpChallengeRow } from './auth.schema.js';

/** The only code that reads or writes otp_challenge. */
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
}
