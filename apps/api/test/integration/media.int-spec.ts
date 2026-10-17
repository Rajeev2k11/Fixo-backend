import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema, type Media, type MediaUploadResponse } from '@fixo/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { SessionsService } from '../../src/modules/auth/sessions.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { FakeStorage } from '../../src/platform/storage/storage.js';
import { newPhone } from './helpers.js';

let app: INestApplication;
let server: Server;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function login(role: 'customer' | 'worker') {
  const { userId } = await app.get(UsersService).findOrCreateByPhone(newPhone(), role);
  const { accessToken } = await app.get(SessionsService).start(userId, role, randomUUID());
  return `Bearer ${accessToken}`;
}

const jpeg = (size = 2048) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size - 4)]);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
/** The signed link is absolute (PUBLIC_BASE_URL); supertest needs the path and query. */
const local = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

async function requestUpload(
  auth: string,
  body: object = { purpose: 'kyc_selfie', contentType: 'image/jpeg', sizeBytes: 2048 },
) {
  return request(server).post('/v1/media/uploads').set('Authorization', auth).send(body);
}
const put = (uploadUrl: string, bytes: Buffer, contentType = 'image/jpeg') =>
  request(server).put(local(uploadUrl)).set('Content-Type', contentType).send(bytes);
const complete = (auth: string, id: string) =>
  request(server).post(`/v1/media/${id}/complete`).set('Authorization', auth).send({});

/** request -> PUT -> complete, returning every response. */
async function uploadFile(auth: string, bytes: Buffer, declared = bytes.length) {
  const req = await requestUpload(auth, {
    purpose: 'kyc_selfie',
    contentType: 'image/jpeg',
    sizeBytes: declared,
  });
  const { mediaId, uploadUrl } = req.body as MediaUploadResponse;
  const uploaded = await put(uploadUrl, bytes);
  const done = await complete(auth, mediaId);
  return { mediaId, uploadUrl, uploaded, done };
}

async function objectKeyOf(mediaId: string): Promise<string> {
  const { rows } = await pool.query<{ object_key: string }>(
    'select object_key from media where id = $1',
    [mediaId],
  );
  return rows[0]?.object_key ?? '';
}

describe('uploading a file', () => {
  it('stores it privately, then the owner downloads the exact bytes through a signed link', async () => {
    const worker = await login('worker');
    const bytes = jpeg();

    const { mediaId, uploaded, done } = await uploadFile(worker, bytes);

    expect(uploaded.status).toBe(200);
    expect(done.status).toBe(200);
    const media = done.body as Media;
    expect(media).toMatchObject({ id: mediaId, status: 'ready', sizeBytes: bytes.length });
    const download = await request(server)
      .get(local(media.downloadUrl ?? ''))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, bytes)).toBe(0);
    expect(download.headers['cache-control']).toContain('no-store');

    const { rowCount } = await pool.query(
      `select 1 from outbox_event where aggregate_id = $1 and type = 'media.ready'`,
      [mediaId],
    );
    expect(rowCount).toBe(1);
  });

  it('is idempotent once ready, and refuses to complete before anything is uploaded', async () => {
    const worker = await login('worker');
    const pending = (await requestUpload(worker)).body as MediaUploadResponse;

    const early = await complete(worker, pending.mediaId);
    await put(pending.uploadUrl, jpeg());
    const first = await complete(worker, pending.mediaId);
    const again = await complete(worker, pending.mediaId);

    expect(early.status).toBe(409);
    expect(errorOf(early.body).code).toBe('MEDIA_NOT_UPLOADED');
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
  });
});

describe('what the server refuses', () => {
  it('a declared size over the configured 5 MB limit, or a type the purpose does not take', async () => {
    const worker = await login('worker');

    const tooBig = await requestUpload(worker, {
      purpose: 'kyc_selfie',
      contentType: 'image/jpeg',
      sizeBytes: 5 * 1024 * 1024 + 1,
    });
    const pdf = await requestUpload(worker, {
      purpose: 'kyc_selfie',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });

    expect(tooBig.status).toBe(400);
    expect(pdf.status).toBe(400);
  });

  it('a KYC selfie from the customer app', async () => {
    const res = await requestUpload(await login('customer'));

    expect(res.status).toBe(403);
  });

  it('bytes that are not the declared image (a renamed file), deleting them', async () => {
    const worker = await login('worker');
    const html = Buffer.from('<html><script>steal()</script></html>');

    const { mediaId, done } = await uploadFile(worker, html);

    expect(done.status).toBe(422);
    expect(errorOf(done.body).code).toBe('MEDIA_REJECTED');
    expect(errorOf(done.body).message).toMatch(/not a valid image\/jpeg/);
    expect(await app.get(FakeStorage).size(await objectKeyOf(mediaId))).toBeNull();
  });

  it('a file that fails the malware scan', async () => {
    const worker = await login('worker');
    const infected = Buffer.concat([jpeg(64), Buffer.from(EICAR)]);

    const { done } = await uploadFile(worker, infected);

    expect(done.status).toBe(422);
    expect(errorOf(done.body).message).toMatch(/malware/);
  });

  it('an upload larger than declared, at the storage itself', async () => {
    const worker = await login('worker');
    const { uploadUrl } = (await requestUpload(worker)).body as MediaUploadResponse; // 2048 declared

    const res = await put(uploadUrl, jpeg(4096));

    expect(res.status).toBe(413);
  });

  it('a Content-Type different from the one declared', async () => {
    const worker = await login('worker');
    const { uploadUrl } = (await requestUpload(worker)).body as MediaUploadResponse;

    expect((await put(uploadUrl, jpeg(), 'image/png')).status).toBe(400);
  });
});

describe('privacy', () => {
  it('other users cannot see or complete your file (it looks like it does not exist)', async () => {
    const owner = await login('worker');
    const stranger = await login('worker');
    const { mediaId } = await uploadFile(owner, jpeg());

    const peek = await request(server).get(`/v1/media/${mediaId}`).set('Authorization', stranger);
    const finish = await complete(stranger, mediaId);

    expect(peek.status).toBe(404);
    expect(finish.status).toBe(404);
  });

  it('refuses tampered and expired links', async () => {
    const worker = await login('worker');
    const { mediaId, done } = await uploadFile(worker, jpeg());
    const url = (done.body as Media).downloadUrl ?? '';
    const tampered = url.replace(/sig=[^&]+/, 'sig=forged');
    const expired = app.get(FakeStorage).downloadUrl(await objectKeyOf(mediaId), 'image/jpeg', -1);

    expect((await request(server).get(local(tampered))).status).toBe(403);
    expect((await request(server).get(local(expired))).status).toBe(403);
  });
});
