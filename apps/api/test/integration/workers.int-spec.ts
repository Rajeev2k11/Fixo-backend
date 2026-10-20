import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema, type WorkerProfile } from '@fixo/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { Actor } from '../../src/common/actor.js';
import { AppError } from '../../src/common/app-error.js';
import { SessionsService } from '../../src/modules/auth/sessions.service.js';
import { ConfigService } from '../../src/modules/config/config.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { WorkerProfileService } from '../../src/modules/users/worker-profile.service.js';
import { createUser, newPhone, resetSharedState, uploadReady } from './helpers.js';

const LUCKNOW = 'd4046302-ed40-4bd0-84a7-7a9c98614777';
let app: INestApplication;
let server: Server;
let ops: Actor;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
  ops = { userId: await createUser(pool), role: 'operations' };
});

afterAll(async () => {
  await resetSharedState(pool); // removes the agreement versions published here
  await app.close();
  await pool.end();
});

async function login(role: 'customer' | 'worker' = 'worker') {
  const { userId } = await app.get(UsersService).findOrCreateByPhone(newPhone(), role);
  const { accessToken } = await app.get(SessionsService).start(userId, role, randomUUID());
  return { userId, auth: `Bearer ${accessToken}` };
}

const me = (auth: string) => request(server).get('/v1/workers/me').set('Authorization', auth);
const patch = (auth: string, body: object) =>
  request(server).patch('/v1/workers/me').set('Authorization', auth).send(body);
const accept = (auth: string, version: string) =>
  request(server).post('/v1/workers/me/agreement').set('Authorization', auth).send({ version });
const publishAgreement = (version: string) =>
  app.get(ConfigService).propose({
    key: 'workers.agreement_version',
    value: version,
    reason: `Publish worker agreement ${version}`,
    actor: ops,
  });
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

describe('worker profile', () => {
  it('starts as registered with everything still to do', async () => {
    const { userId, auth } = await login();

    const res = await me(auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId,
      status: 'registered',
      name: null,
      photo: null,
      cityId: null,
      missing: ['name', 'photo', 'city', 'agreement'],
    });
  });

  it('is only for the worker app', async () => {
    const { auth } = await login('customer');

    const res = await me(auth);

    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe('FORBIDDEN');
  });

  it('takes a name, an own ready photo and an active city', async () => {
    const { auth } = await login();
    const photo = await uploadReady(server, auth, 'profile_photo');

    const res = await patch(auth, { name: 'Ramesh Kumar', photoMediaId: photo, cityId: LUCKNOW });

    expect(res.status).toBe(200);
    const profile = res.body as WorkerProfile;
    expect(profile).toMatchObject({
      name: 'Ramesh Kumar',
      cityId: LUCKNOW,
      missing: ['agreement'],
    });
    expect(profile.photo?.mediaId).toBe(photo);
    expect(profile.photo?.url).toContain('/v1/dev/storage/profile_photo/');
  });

  it('refuses photos that are not your own ready profile photo, and unserved cities', async () => {
    const { auth } = await login();
    const stranger = await login();
    const theirs = await uploadReady(server, stranger.auth, 'profile_photo');
    const selfie = await uploadReady(server, auth, 'kyc_selfie');
    const unfinished = await uploadReady(server, auth, 'profile_photo', { complete: false });

    for (const photoMediaId of [theirs, selfie, unfinished]) {
      expect((await patch(auth, { photoMediaId })).status).toBe(400);
    }
    expect((await patch(auth, { cityId: randomUUID() })).status).toBe(400);
    expect((await patch(auth, {})).status).toBe(400);
  });
});

describe('worker agreement', () => {
  it('can only be accepted once published, and only in its current version', async () => {
    const { auth } = await login();
    const unpublished = await accept(auth, 'v1');
    expect(unpublished.status).toBe(503);
    expect(errorOf(unpublished.body).code).toBe('AGREEMENT_NOT_PUBLISHED');

    await publishAgreement('2026-10-v1');
    const stale = await accept(auth, '2026-09-draft');
    const ok = await accept(auth, '2026-10-v1');

    expect(stale.status).toBe(409);
    expect(errorOf(stale.body).code).toBe('AGREEMENT_OUTDATED');
    expect(ok.status).toBe(200);
    expect((ok.body as WorkerProfile).agreement).toMatchObject({
      acceptedVersion: '2026-10-v1',
      currentVersion: '2026-10-v1',
    });
    expect((ok.body as WorkerProfile).missing).not.toContain('agreement');

    // A new version puts the agreement back on the to-do list until accepted.
    await publishAgreement('2026-11-v2');
    expect(((await me(auth)).body as WorkerProfile).missing).toContain('agreement');
    expect((await accept(auth, '2026-11-v2')).status).toBe(200);
  });
});

describe('worker status (WORKER-1)', () => {
  const transitions = () => app.get(WorkerProfileService);

  async function code(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof AppError) return err.code;
      throw err;
    }
    throw new Error('expected an AppError');
  }

  it('writes history and an event on every move, and audits admin moves only', async () => {
    const { userId } = await login();
    const self: Actor = { userId, role: 'worker' };

    await transitions().transition({ userId, to: 'kyc_pending', actor: self, reason: 'submitted' });
    await transitions().transition({ userId, to: 'under_review', actor: null, reason: 'kyc ok' });
    await transitions().transition({
      userId,
      to: 'registered',
      actor: ops,
      reason: 'Selfie is blurry',
      statusReason: 'Please upload a clear selfie',
    });

    const history = await pool.query<{ to_status: string }>(
      'select to_status from worker_status_history where user_id = $1 order by created_at',
      [userId],
    );
    expect(history.rows.map((r) => r.to_status)).toEqual([
      'kyc_pending',
      'under_review',
      'registered',
    ]);
    const events = await pool.query(
      `select 1 from outbox_event where aggregate_id = $1 and type = 'worker.status_changed'`,
      [userId],
    );
    expect(events.rowCount).toBe(3);
    const audits = await pool.query<{ action: string; reason: string }>(
      'select action, reason from audit_log where entity_id = $1',
      [userId],
    );
    expect(audits.rows).toEqual([{ action: 'worker.status_changed', reason: 'Selfie is blurry' }]);
  });

  it('shows the resubmission reason to the worker', async () => {
    const { userId, auth } = await login();
    await transitions().transition({ userId, to: 'kyc_pending', actor: null, reason: 'x' });
    await transitions().transition({ userId, to: 'under_review', actor: null, reason: 'x' });
    await transitions().transition({
      userId,
      to: 'registered',
      actor: ops,
      reason: 'Name mismatch with Aadhaar',
      statusReason: 'Use your name as on Aadhaar',
    });

    const profile = (await me(auth)).body as WorkerProfile;

    expect(profile).toMatchObject({
      status: 'registered',
      statusReason: 'Use your name as on Aadhaar',
    });
  });

  it('locks the profile after submitting', async () => {
    const { userId, auth } = await login();
    await transitions().transition({ userId, to: 'kyc_pending', actor: null, reason: 'submitted' });

    const res = await patch(auth, { name: 'Changed After Submit' });

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('PROFILE_LOCKED');
  });

  it('refuses moves WORKER-1 does not allow, and stale versions', async () => {
    const { userId } = await login();

    expect(
      await code(transitions().transition({ userId, to: 'verified', actor: ops, reason: 'skip' })),
    ).toBe('INVALID_TRANSITION');
    expect(
      await code(
        transitions().transition({
          userId,
          to: 'kyc_pending',
          actor: null,
          reason: 'old screen',
          expectedVersion: 7,
        }),
      ),
    ).toBe('CONCURRENT_UPDATE');
  });
});
