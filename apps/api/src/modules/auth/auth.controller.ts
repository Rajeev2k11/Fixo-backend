import {
  otpRequestSchema,
  type OtpRequest,
  type OtpRequestResponse,
  otpVerifySchema,
  type OtpVerify,
  type OtpVerifyResponse,
} from '@fixo/contracts';
import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';

// App-generated id of the install; device registration and binding arrive in step 1.10.
// (@Headers() accepts no pipes, so the pipe is applied by hand.)
const deviceId = new ZodValidationPipe(z.uuid().optional());

@Controller('auth/otp')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request')
  @HttpCode(202)
  request(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
    @Ip() ip: string,
    @Headers('x-device-id') rawDeviceId: string | undefined,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body.phone, { ip, deviceId: deviceId.transform(rawDeviceId) });
  }

  @Post('verify')
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerify,
  ): Promise<OtpVerifyResponse> {
    return this.auth.verifyOtp(body);
  }
}
