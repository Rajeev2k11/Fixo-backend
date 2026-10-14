import {
  ErrorCode,
  type OtpRequestResponse,
  type OtpVerify,
  type OtpVerifyResponse,
} from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { env } from '../../common/env.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { enqueueOtpSms, SMS_QUEUE } from '../../platform/sms/sms.js';
import { ConfigService } from '../config/config.service.js';
import { UsersService } from '../users/users.service.js';
import {
  OTP_LENGTH,
  OTP_LIMIT_PER_DEVICE,
  OTP_LIMIT_PER_IP,
  OTP_LIMIT_PER_PHONE,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './auth.config.js';
import { AuthRepository } from './auth.repository.js';
import { generateCode, hashesEqual, hmac, resendCooldown } from './domain/otp.rules.js';

export interface RequestOrigin {
  ip: string;
  deviceId?: string | undefined;
}

const rateLimited = (retryAfterSeconds: number) =>
  new AppError(ErrorCode.RATE_LIMITED, 429, 'Too many requests. Please wait and try again.', {
    retryAfterSeconds,
  });

// One message for every failure, so the response never says whether a number or code was close.
const invalid = (message = 'The code is incorrect or has expired') =>
  new AppError(ErrorCode.OTP_INVALID, 401, message);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SMS_QUEUE) private readonly smsQueue: Queue,
    private readonly repo: AuthRepository,
    private readonly limiter: RateLimiter,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  /**
   * Sends an OTP. The response is the same whether or not the number has an account (spec §M),
   * and nothing here even looks at users.
   */
  async requestOtp(phone: string, origin: RequestOrigin): Promise<OtpRequestResponse> {
    const phoneHash = hmac(env.OTP_HMAC_SECRET, `phone:${phone}`);
    const [length, ttl, perPhone, perIp, perDevice, cooldownBase] = await Promise.all([
      this.config.resolve(OTP_LENGTH),
      this.config.resolve(OTP_TTL_SECONDS),
      this.config.resolve(OTP_LIMIT_PER_PHONE),
      this.config.resolve(OTP_LIMIT_PER_IP),
      this.config.resolve(OTP_LIMIT_PER_DEVICE),
      this.config.resolve(OTP_RESEND_COOLDOWN_SECONDS),
    ]);

    const waiting = await this.limiter.cooldownLeft(`otp:${phoneHash}`);
    if (waiting > 0) throw rateLimited(waiting);

    // ponytail: origin.ip is the socket address; behind a load balancer, set Express
    // 'trust proxy' at deploy time or every user shares the balancer's IP limit.
    const [byPhone, ...others] = await Promise.all([
      this.limiter.hit(`otp:phone:${phoneHash}`, perPhone.value.max, perPhone.value.windowSeconds),
      this.limiter.hit(`otp:ip:${origin.ip}`, perIp.value.max, perIp.value.windowSeconds),
      ...(origin.deviceId
        ? [
            this.limiter.hit(
              `otp:device:${origin.deviceId}`,
              perDevice.value.max,
              perDevice.value.windowSeconds,
            ),
          ]
        : []),
    ]);
    const blocked = [byPhone, ...others].filter((h) => !h.allowed);
    if (blocked.length > 0) throw rateLimited(Math.max(...blocked.map((h) => h.retryAfterSeconds)));

    const code = generateCode(length.value);
    const expiresAt = new Date(Date.now() + ttl.value * 1000);
    await this.db.transaction((tx) =>
      this.repo.replaceChallenge(tx, phoneHash, this.codeHash(phoneHash, code), expiresAt),
    );
    await enqueueOtpSms(this.smsQueue, { phone, code });

    const resendAfter = resendCooldown(cooldownBase.value, byPhone.count);
    await this.limiter.startCooldown(`otp:${phoneHash}`, resendAfter);
    return { expiresInSeconds: ttl.value, resendAfterSeconds: resendAfter };
  }

  /**
   * Checks a code. A wrong guess is committed before the error is thrown, so attempts add up
   * even though each request fails.
   */
  async verifyOtp(input: OtpVerify): Promise<OtpVerifyResponse> {
    const phoneHash = hmac(env.OTP_HMAC_SECRET, `phone:${input.phone}`);
    const { value: maxAttempts } = await this.config.resolve(OTP_MAX_ATTEMPTS);

    const outcome = await this.db.transaction(async (tx) => {
      const challenge = await this.repo.lockOpenChallenge(tx, phoneHash);
      if (!challenge) return 'invalid' as const;
      if (challenge.attempts >= maxAttempts) return 'locked' as const;
      if (!hashesEqual(challenge.codeHash, this.codeHash(phoneHash, input.code))) {
        await this.repo.recordFailedAttempt(tx, challenge.id);
        return 'invalid' as const;
      }
      await this.repo.consume(tx, challenge.id);
      return 'ok' as const;
    });

    if (outcome === 'locked') throw invalid('Too many wrong attempts. Request a new code.');
    if (outcome === 'invalid') throw invalid();
    const { userId, roles, isNew } = await this.users.findOrCreateByPhone(input.phone, input.role);
    return { userId, roles, isNew };
  }

  private codeHash(phoneHash: string, code: string): string {
    return hmac(env.OTP_HMAC_SECRET, `otp:${phoneHash}:${code}`);
  }
}
