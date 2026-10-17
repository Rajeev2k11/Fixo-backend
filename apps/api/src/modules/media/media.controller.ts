import {
  type Media,
  type MediaUploadRequest,
  mediaUploadRequestSchema,
  type MediaUploadResponse,
} from '@fixo/contracts';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/sessions.service.js';
import { MediaService } from './media.service.js';

const idPipe = new ZodValidationPipe(z.uuid());

/** Private uploads for the apps (spec §B.3 photos, §C.5 KYC selfie). Owners only. */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  requestUpload(
    @Body(new ZodValidationPipe(mediaUploadRequestSchema)) body: MediaUploadRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MediaUploadResponse> {
    return this.media.requestUpload(auth, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', idPipe) id: string, @CurrentAuth() auth: AuthContext): Promise<Media> {
    return this.media.complete(auth, id);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string, @CurrentAuth() auth: AuthContext): Promise<Media> {
    return this.media.get(auth, id);
  }
}
