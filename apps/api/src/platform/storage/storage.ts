import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { ErrorCode } from '@fixo/contracts';
import { Controller, Get, Injectable, Module, Param, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppError } from '../../common/app-error.js';
import { env } from '../../common/env.js';
import { Public } from '../../modules/auth/auth.guard.js';

/**
 * Private object storage (CLAUDE.md rule 11): an interface plus a Fake. Clients never get a
 * bucket path, only short-lived signed links issued after an authorization check (spec §T).
 */
export interface StorageAdapter {
  /** A URL the client PUTs the file to, valid for `expiresInSeconds`, refusing more than `maxBytes`. */
  uploadUrl(key: string, contentType: string, maxBytes: number, expiresInSeconds: number): string;
  /** A URL that serves the file, valid for `expiresInSeconds`. */
  downloadUrl(key: string, contentType: string, expiresInSeconds: number): string;
  /** Size in bytes, or null if nothing was uploaded. */
  size(key: string): Promise<number | null>;
  /** The first `bytes` bytes, for type sniffing and scanning. */
  head(key: string, bytes: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url)); // repo root
const KEY = /^[a-z_]+\/[0-9a-f-]{36}$/; // purpose/uuid, the only shape media keys take
const DEV_PATH = '/v1/dev/storage';

/** Signs a dev link; JWT_SECRET with a purpose label, so a link cannot pass as anything else. */
function sign(fields: string[]): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(['storage-link', ...fields].join('\n'))
    .digest('base64url');
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Development storage: files on local disk, links served by DevStorageController with an HMAC
 * signature and expiry, mimicking R2 presigned URLs. Refused in production (env.ts).
 */
@Injectable()
export class FakeStorage implements StorageAdapter {
  readonly dir = path.resolve(ROOT, env.STORAGE_LOCAL_DIR);

  uploadUrl(key: string, contentType: string, maxBytes: number, expiresInSeconds: number): string {
    const exp = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    const max = String(maxBytes);
    const sig = sign(['put', key, contentType, max, exp]);
    const query = new URLSearchParams({ ct: contentType, max, exp, sig });
    return `${env.PUBLIC_BASE_URL}${DEV_PATH}/${key}?${query.toString()}`;
  }

  downloadUrl(key: string, contentType: string, expiresInSeconds: number): string {
    const exp = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    const sig = sign(['get', key, contentType, exp]);
    const query = new URLSearchParams({ ct: contentType, exp, sig });
    return `${env.PUBLIC_BASE_URL}${DEV_PATH}/${key}?${query.toString()}`;
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }

  async head(key: string, bytes: number): Promise<Buffer> {
    const handle = await open(this.file(key), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  file(key: string): string {
    if (!KEY.test(key)) throw new Error('invalid storage key');
    return path.join(this.dir, key);
  }
}

const denied = () => new AppError(ErrorCode.FORBIDDEN, 403, 'This link is invalid or has expired');

function checkLink(op: 'put' | 'get', key: string, query: Record<string, string | undefined>) {
  const { ct = '', max = '', exp = '', sig = '' } = query;
  const fields = op === 'put' ? [op, key, ct, max, exp] : [op, key, ct, exp];
  if (!KEY.test(key) || !sameSignature(sign(fields), sig)) throw denied();
  if (Number(exp) < Date.now() / 1000) throw denied();
  return { contentType: ct, maxBytes: Number(max) };
}

/** Plays the role of the bucket in development. Authenticated by the link signature, not a token. */
@Public()
@Controller('dev/storage')
export class DevStorageController {
  constructor(private readonly storage: FakeStorage) {}

  @Put(':purpose/:id')
  async upload(
    @Param('purpose') purpose: string,
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = `${purpose}/${id}`;
    const { contentType, maxBytes } = checkLink('put', key, query);
    if (req.header('content-type') !== contentType) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, `Content-Type must be ${contentType}`);
    }
    const target = this.storage.file(key);
    await mkdir(path.dirname(target), { recursive: true });
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        done(received > maxBytes ? new Error('too large') : null, chunk);
      },
    });
    try {
      await pipeline(req, limit, createWriteStream(target));
    } catch {
      await this.storage.remove(key);
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        413,
        `File is larger than ${String(maxBytes)} bytes`,
      );
    }
    res.status(200).end();
  }

  @Get(':purpose/:id')
  async download(
    @Param('purpose') purpose: string,
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const key = `${purpose}/${id}`;
    const { contentType } = checkLink('get', key, query);
    if ((await this.storage.size(key)) === null) throw denied();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(createReadStream(this.storage.file(key)), res);
  }
}

/** Storage for the app: the fake (with its dev routes) until R2 credentials exist. */
@Module({
  controllers: [DevStorageController],
  providers: [FakeStorage, { provide: STORAGE, useExisting: FakeStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
