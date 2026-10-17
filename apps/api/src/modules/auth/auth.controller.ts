import {
  type LogoutRequest,
  logoutRequestSchema,
  otpRequestSchema,
  type OtpRequest,
  type OtpRequestResponse,
  otpVerifySchema,
  type OtpVerify,
  type OtpVerifyResponse,
  type RefreshRequest,
  refreshRequestSchema,
  type TokenPair,
} from '@fixo/contracts';
import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

// X-Device-Id: an app-generated id of the install (UUID). Optional when requesting an OTP
// (it only adds a rate limit); required wherever a session is bound to the device.
// (@Headers() accepts no pipes, so the pipes are applied by hand.)
const optionalDeviceId = new ZodValidationPipe(z.uuid().optional());
const requiredDeviceId = new ZodValidationPipe(z.uuid({ error: 'X-Device-Id (UUID) is required' }));

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('otp/request')
  @HttpCode(202)
  request(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
    @Ip() ip: string,
    @Headers('x-device-id') deviceId: string | undefined,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body.phone, { ip, deviceId: optionalDeviceId.transform(deviceId) });
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerify,
    @Headers('x-device-id') deviceId: string | undefined,
  ): Promise<OtpVerifyResponse> {
    return this.auth.verifyOtp(body, requiredDeviceId.transform(deviceId));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Headers('x-device-id') deviceId: string | undefined,
  ): Promise<TokenPair> {
    return this.sessions.refresh(body.refreshToken, requiredDeviceId.transform(deviceId));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(logoutRequestSchema)) body: LogoutRequest,
  ): Promise<void> {
    await this.sessions.logout(body.refreshToken);
  }
}
