import { randomUUID } from 'node:crypto';

import {
  ErrorCode,
  type Media,
  type MediaUploadRequest,
  type MediaUploadResponse,
} from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { appendOutbox } from '../../platform/outbox/outbox.js';
import { MALWARE_SCANNER, type MalwareScanner } from '../../platform/storage/malware-scanner.js';
import { STORAGE, type StorageAdapter } from '../../platform/storage/storage.js';
import type { AuthContext } from '../auth/sessions.service.js';
import { ConfigService } from '../config/config.service.js';
import { PURPOSE_RULES, SNIFF_BYTES, sniffImageType } from './domain/media.rules.js';
import { MEDIA_MAX_UPLOAD_BYTES } from './media.config.js';
import { MediaRepository } from './media.repository.js';
import type { MediaRow } from './media.schema.js';

// Link lifetimes: long enough to upload a photo on a slow connection, short enough to be useless
// if leaked (spec §T "short-lived").
const UPLOAD_URL_SECONDS = 15 * 60;
const DOWNLOAD_URL_SECONDS = 5 * 60;

const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'File not found');

type CompleteOutcome =
  { ok: true; row: MediaRow } | { ok: false; error: 'not_uploaded' | 'rejected'; reason?: string };

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly repo: MediaRepository,
    private readonly config: ConfigService,
  ) {}

  /** Step 1: a short-lived URL the app uploads the file to directly (never through our servers in prod). */
  async requestUpload(auth: AuthContext, input: MediaUploadRequest): Promise<MediaUploadResponse> {
    if (!PURPOSE_RULES[input.purpose].roles.includes(auth.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, `Your app cannot upload ${input.purpose}`);
    }
    const { value: maxBytes } = await this.config.resolve(MEDIA_MAX_UPLOAD_BYTES);
    if (input.sizeBytes > maxBytes) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Files may be at most ${String(maxBytes)} bytes`,
        { maxBytes },
      );
    }
    const expiresAt = new Date(Date.now() + UPLOAD_URL_SECONDS * 1000);
    const row = await this.repo.insert(this.db, {
      ownerUserId: auth.userId,
      purpose: input.purpose,
      contentType: input.contentType,
      declaredBytes: input.sizeBytes,
      objectKey: `${input.purpose}/${randomUUID()}`,
      uploadExpiresAt: expiresAt,
    });
    return {
      mediaId: row.id,
      uploadUrl: this.storage.uploadUrl(
        row.objectKey,
        row.contentType,
        row.declaredBytes,
        UPLOAD_URL_SECONDS,
      ),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Step 2: checks what actually arrived. The client's word is not trusted: the type is read
   * from the file's own bytes, the size is measured, and the content is scanned. A refused file
   * is deleted. Safe to call again once ready.
   */
  async complete(auth: AuthContext, id: string): Promise<Media> {
    const outcome = await this.db.transaction(async (tx): Promise<CompleteOutcome> => {
      const row = await this.repo.lockOwned(tx, id, auth.userId);
      if (!row) throw notFound();
      if (row.status === 'ready') return { ok: true, row };
      if (row.status === 'rejected')
        return { ok: false, error: 'rejected', reason: row.rejectReason ?? '' };

      const size = await this.storage.size(row.objectKey);
      if (size === null || size === 0) return { ok: false, error: 'not_uploaded' };
      const start = await this.storage.head(row.objectKey, SNIFF_BYTES);
      const reason =
        size > row.declaredBytes
          ? 'larger than declared'
          : sniffImageType(start) !== row.contentType
            ? `not a valid ${row.contentType} file`
            : (await this.scanner.scan(start)) === 'infected'
              ? 'failed the malware scan'
              : null;
      if (reason) {
        await this.repo.markRejected(tx, row.id, reason);
        await this.storage.remove(row.objectKey);
        return { ok: false, error: 'rejected', reason };
      }

      const ready = await this.repo.markReady(tx, row.id, size);
      await appendOutbox(tx, {
        type: 'media.ready',
        aggregateType: 'media',
        aggregateId: ready.id,
        payload: { purpose: ready.purpose, ownerUserId: ready.ownerUserId },
      });
      return { ok: true, row: ready };
    });

    if (outcome.ok) return this.view(outcome.row);
    if (outcome.error === 'not_uploaded') {
      throw new AppError(ErrorCode.MEDIA_NOT_UPLOADED, 409, 'Upload the file before completing');
    }
    throw new AppError(
      ErrorCode.MEDIA_REJECTED,
      422,
      `The file was refused: ${outcome.reason ?? 'invalid'}. Upload a new one.`,
    );
  }

  /**
   * For other modules: confirms `mediaId` is a ready file of `purpose` owned by `ownerUserId`,
   * so a worker cannot attach someone else's photo or an unchecked upload.
   */
  async assertUsable(
    ownerUserId: string,
    mediaId: string,
    purpose: MediaRow['purpose'],
  ): Promise<void> {
    const row = await this.repo.findOwned(this.db, mediaId, ownerUserId);
    if (row?.status !== 'ready' || row.purpose !== purpose) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Upload a ${purpose} first and use its id`,
        { mediaId },
      );
    }
  }

  /** A fresh short-lived link to a file, for an owner or an already-authorised caller. */
  async linkFor(mediaId: string): Promise<string | null> {
    const row = await this.repo.findById(this.db, mediaId);
    return row?.status === 'ready' ? this.view(row).downloadUrl : null;
  }

  /** The caller's own file, with a fresh short-lived link when it is ready. */
  async get(auth: AuthContext, id: string): Promise<Media> {
    const row = await this.repo.findOwned(this.db, id, auth.userId);
    if (!row) throw notFound();
    return this.view(row);
  }

  private view(row: MediaRow): Media {
    const ready = row.status === 'ready';
    return {
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      downloadUrl: ready
        ? this.storage.downloadUrl(row.objectKey, row.contentType, DOWNLOAD_URL_SECONDS)
        : null,
      downloadUrlExpiresAt: ready
        ? new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString()
        : null,
    };
  }
}
