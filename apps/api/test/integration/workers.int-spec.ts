import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import {
  type EventEnvelope,
  errorBodySchema,
  type WorkerOnboarding,
  type WorkerProfile,
} from '@fixo/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { Actor } from '../../src/common/actor.js';
import { AppError } from '../../src/common/app-error.js';
import { SessionsService } from '../../src/modules/auth/sessions.service.js';
import { CatalogueService } from '../../src/modules/catalogue/catalogue.service.js';
import { ConfigService } from '../../src/modules/config/config.service.js';
import { GeoService } from '../../src/modules/geo/geo.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { WorkerProfileService } from '../../src/modules/users/worker-profile.service.js';
import { RunKycCheckOnSubmit } from '../../src/modules/workers/workers.consumers.js';
import { FakeKycChecker } from '../../src/platform/kyc/kyc-checker.js';
import { DomainEventsWorker } from '../../src/platform/outbox/domain-events.worker.js';
import { createUser, newPhone, resetSharedState, uploadReady } from './helpers.js';

const LUCKNOW = 'd4046302-ed40-4bd0-84a7-7a9c98614777';
const AGREEMENT = '2026-10-v1';
let app: INestApplication;
let server: Server;
let ops: Actor;
let areaIds: string[];
let categoryIds: string[];
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
  ops = { userId: await createUser(pool), role: 'operations' };

  // Reference data an admin enters (decision REF-1: nothing is seeded). Names are unique per run.
  const tag = randomUUID().slice(0, 8);
  const geo = app.get(GeoService);
  const catalogue = app.get(CatalogueService);
  areaIds = [
    (await geo.createArea({ cityId: LUCKNOW, name: `Gomti ${tag}`, reason: 'test setup' }, ops)).id,
    (await geo.createArea({ cityId: LUCKNOW, name: `Aliganj ${tag}`, reason: 'test setup' }, ops))
      .id,
  ];
  categoryIds = [
    (
      await catalogue.createCategory(
        { slug: `ac-${tag}`, name: 'AC Service', reason: 'test setup' },
        ops,
      )
    ).id,
    (
      await catalogue.createCategory(
        { slug: `plumber-${tag}`, name: 'Plumber', reason: 'test setup' },
        ops,
      )
    ).id,
  ];
  await app.get(ConfigService).propose({
    key: 'workers.agreement_version',
    value: AGREEMENT,
    reason: 'Publish worker agreement',
    actor: ops,
  });
});

afterAll(async () => {
  await resetSharedState(pool); // removes the agreement version published here
  await app.close();
  await pool.end();
});

async function login(role: 'customer' | 'worker' = 'worker') {
  const { userId } = await app.get(UsersService).findOrCreateByPhone(newPhone(), role);
  const { accessToken } = await app.get(SessionsService).start(userId, role, randomUUID());
  return { userId, auth: `Bearer ${accessToken}` };
}

/** Uploads the four files the way the app does and builds a complete, valid submission. */
async function completeForm(auth: string): Promise<WorkerOnboarding> {
  const [photo, front, back, selfie] = await Promise.all([
    uploadReady(server, auth, 'profile_photo'),
    uploadReady(server, auth, 'aadhaar_front'),
    uploadReady(server, auth, 'aadhaar_back'),
    uploadReady(server, auth, 'kyc_selfie'),
  ]);
  return {
    name: 'Ramesh Kumar',
    photoMediaId: photo,
    cityId: LUCKNOW,
    wholeCity: false,
    areaIds: [areaIds[0] ?? ''],
    categoryIds: [categoryIds[0] ?? '', categoryIds[1] ?? ''],
    experienceYears: 6,
    about: 'Havells service centre, inverter wiring',
    kyc: { aadhaarFrontMediaId: front, aadhaarBackMediaId: back, selfieMediaId: selfie },
    availability: {
      days: ['Mon', 'Tue', 'Sat'],
      allDay: false,
      startTime: '09:00',
      endTime: '19:00',
      emergency: true,
    },
    agreementVersion: AGREEMENT,
  };
}

const me = (auth: string) => request(server).get('/v1/workers/me').set('Authorization', auth);
const submit = (auth: string, body: object) =>
  request(server).post('/v1/workers/me/onboarding').set('Authorization', auth).send(body);
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

/** Runs the jobs-process consumer for the latest worker.status_changed event of this worker. */
async function runKycCheck(userId: string) {
  const { rows } = await pool.query<{
    id: string;
    type: string;
    aggregate_type: string;
    aggregate_id: string;
    occurred_at: Date;
    payload: Record<string, unknown>;
  }>(
    `select * from outbox_event where aggregate_id = $1 and type = 'worker.status_changed'
     order by occurred_at desc limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error('no worker.status_changed event');
  const event: EventEnvelope = {
    id: row.id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at.toISOString(),
    payload: row.payload,
  };
  const handler = new RunKycCheckOnSubmit(app.get(WorkerProfileService), new FakeKycChecker());
  await new DomainEventsWorker(db, [handler]).dispatch(event);
}

describe('reference data for the app pickers (REF-1)', () => {
  it('lists active cities, a city’s areas and service categories without logging in', async () => {
    const cities = await request(server).get('/v1/cities');
    const areas = await request(server).get(`/v1/areas?cityId=${LUCKNOW}`);
    const categories = await request(server).get('/v1/services/categories');

    expect(cities.body).toContainEqual({ id: LUCKNOW, name: 'Lucknow' });
    expect((areas.body as { id: string }[]).map((a) => a.id)).toEqual(
      expect.arrayContaining(areaIds),
    );
    expect((categories.body as { id: string }[]).map((c) => c.id)).toEqual(
      expect.arrayContaining(categoryIds),
    );
  });

  it('refuses a duplicate area in the same city', async () => {
    const name = `Chowk ${randomUUID().slice(0, 8)}`;
    await app.get(GeoService).createArea({ cityId: LUCKNOW, name, reason: 'first' }, ops);

    await expect(
      app.get(GeoService).createArea({ cityId: LUCKNOW, name, reason: 'again' }, ops),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });
});

describe('onboarding submission (all steps at once)', () => {
  it('starts empty, then stores every step and moves the worker to kyc_pending', async () => {
    const { userId, auth } = await login();
    const before = (await me(auth)).body as WorkerProfile;
    expect(before).toMatchObject({
      status: 'registered',
      submittedAt: null,
      agreement: { currentVersion: AGREEMENT, acceptedVersion: null },
      onboarding: {
        name: null,
        areaIds: [],
        categoryIds: [],
        kycSubmitted: false,
        availability: null,
      },
    });

    const form = await completeForm(auth);
    const res = await submit(auth, form);

    expect(res.status).toBe(200);
    const after = res.body as WorkerProfile;
    expect(after).toMatchObject({
      userId,
      status: 'kyc_pending',
      agreement: { acceptedVersion: AGREEMENT },
      onboarding: {
        name: 'Ramesh Kumar',
        cityId: LUCKNOW,
        wholeCity: false,
        areaIds: form.areaIds,
        experienceYears: 6,
        availability: form.availability,
        kycSubmitted: true,
      },
    });
    expect(after.onboarding.categoryIds.toSorted()).toEqual(form.categoryIds.toSorted());
    expect(after.onboarding.photo?.url).toContain('/v1/dev/storage/profile_photo/');
    expect(after.submittedAt).not.toBeNull();
  });

  it('reaches the admin queue (under_review) once the automated KYC check has run', async () => {
    const { userId, auth } = await login();
    await submit(auth, await completeForm(auth));

    await runKycCheck(userId);

    expect(((await me(auth)).body as WorkerProfile).status).toBe('under_review');
  });

  it('reports every problem at once, with the field path, and saves nothing', async () => {
    const { auth } = await login();
    const stranger = await login();
    const form = await completeForm(auth);
    const theirPhoto = await uploadReady(server, stranger.auth, 'profile_photo');

    const res = await submit(auth, {
      ...form,
      photoMediaId: theirPhoto, // someone else's file
      kyc: { ...form.kyc, aadhaarBackMediaId: form.kyc.aadhaarFrontMediaId }, // wrong purpose
      areaIds: [randomUUID()], // not an area of the city
      categoryIds: [randomUUID()], // unknown service
    });

    expect(res.status).toBe(400);
    const paths = (errorOf(res.body).details as { path: string }[]).map((d) => d.path).toSorted();
    expect(paths).toEqual(['areaIds', 'categoryIds', 'kyc.aadhaarBackMediaId', 'photoMediaId']);
    expect(((await me(auth)).body as WorkerProfile).status).toBe('registered');
  });

  it('checks the shape too: areas or whole city, and end time after start time', async () => {
    const { auth } = await login();
    const form = await completeForm(auth);

    const res = await submit(auth, {
      ...form,
      areaIds: [],
      availability: { ...form.availability, startTime: '18:00', endTime: '09:00' },
    });

    expect(res.status).toBe(400);
    const paths = (errorOf(res.body).details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['areaIds', 'availability.endTime']));
  });

  it('accepts the whole city instead of a list of areas', async () => {
    const { auth } = await login();

    const res = await submit(auth, { ...(await completeForm(auth)), wholeCity: true, areaIds: [] });

    expect(res.status).toBe(200);
    expect((res.body as WorkerProfile).onboarding).toMatchObject({ wholeCity: true, areaIds: [] });
  });

  it('only accepts the current agreement version', async () => {
    const { auth } = await login();

    const res = await submit(auth, {
      ...(await completeForm(auth)),
      agreementVersion: '2026-09-draft',
    });

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('AGREEMENT_OUTDATED');
  });

  it('cannot be submitted twice, but can be resubmitted after being sent back', async () => {
    const { userId, auth } = await login();
    await submit(auth, await completeForm(auth));
    const twice = await submit(auth, await completeForm(auth));
    expect(twice.status).toBe(409);
    expect(errorOf(twice.body).code).toBe('PROFILE_LOCKED');

    await runKycCheck(userId);
    await app.get(WorkerProfileService).transition({
      userId,
      to: 'registered',
      actor: ops,
      reason: 'Aadhaar photo is blurry',
      statusReason: 'Please upload a clearer photo of the Aadhaar back side',
    });
    const sentBack = (await me(auth)).body as WorkerProfile;
    expect(sentBack).toMatchObject({
      status: 'registered',
      statusReason: 'Please upload a clearer photo of the Aadhaar back side',
    });

    const again = await submit(auth, {
      ...(await completeForm(auth)),
      areaIds: [areaIds[1] ?? ''],
    });
    expect(again.status).toBe(200);
    expect((again.body as WorkerProfile).onboarding.areaIds).toEqual([areaIds[1]]); // replaced
  });

  it('is only for the worker app', async () => {
    const { auth } = await login('customer');

    expect((await me(auth)).status).toBe(403);
    expect((await submit(auth, {})).status).toBe(403);
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
    const audits = await pool.query<{ action: string; reason: string }>(
      'select action, reason from audit_log where entity_id = $1',
      [userId],
    );
    expect(audits.rows).toEqual([{ action: 'worker.status_changed', reason: 'Selfie is blurry' }]);
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
