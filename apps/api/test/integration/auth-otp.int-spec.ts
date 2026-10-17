import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema } from '@fixo/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { queuePrefix, redisOptions } from '../../src/common/redis.js';
import { ConfigService } from '../../src/modules/config/config.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { type OtpSmsJob, SMS_QUEUE_NAME } from '../../src/platform/sms/sms.js';
import { createUser, newPhone, resetSharedState, sentCode as sentCodeFrom } from './helpers.js';

let app: INestApplication;
let server: Server;
let smsQueue: Queue<OtpSmsJob>;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
  // No worker runs in tests, so queued SMS stay here for us to read, as the jobs process would.
  smsQueue = new Queue(SMS_QUEUE_NAME, { connection: redisOptions(), prefix: queuePrefix });
});

afterAll(async () => {
  await resetSharedState(pool);
  await smsQueue.close();
  await app.close();
  await pool.end();
});

const requestOtp = (phone: string, deviceId?: string) => {
  const req = request(server).post('/v1/auth/otp/request');
  return (deviceId ? req.set('X-Device-Id', deviceId) : req).send({ phone });
};
// Verify binds the new session to the device, so X-Device-Id is required (step 1.10).
const verify = (phone: string, code: string, role = 'customer') =>
  request(server)
    .post('/v1/auth/otp/verify')
    .set('X-Device-Id', randomUUID())
    .send({ phone, code, role });

const sentCode = (phone: string) => sentCodeFrom(smsQueue, phone);

const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

describe('OTP login with the launch defaults (OTP-1)', () => {
  it('queues the code for SMS and stores only hashes', async () => {
    const phone = newPhone();

    const res = await requestOtp(phone);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ expiresInSeconds: 300, resendAfterSeconds: 30 });
    const code = await sentCode(phone);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await pool.query('select * from otp_challenge');
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(phone);
  });

  it('answers identically for registered and unknown numbers', async () => {
    const registered = newPhone();
    await app.get(UsersService).findOrCreateByPhone(registered, 'customer');

    const a = await requestOtp(registered);
    const b = await requestOtp(newPhone());

    expect([a.status, a.body]).toEqual([b.status, b.body]);
  });

  it('signs the user up with the right code, which then cannot be reused', async () => {
    const phone = newPhone();
    await requestOtp(phone);
    const code = await sentCode(phone);

    const ok = await verify(phone, code);
    const reuse = await verify(phone, code);

    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ roles: ['customer'], isNew: true });
    expect(reuse.status).toBe(401);
    expect(errorOf(reuse.body).code).toBe('OTP_INVALID');
  });

  it('locks the code after 5 wrong attempts, even against the right one', async () => {
    const phone = newPhone();
    await requestOtp(phone);
    const code = await sentCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) expect((await verify(phone, wrong)).status).toBe(401);
    const right = await verify(phone, code);

    expect(right.status).toBe(401);
    expect(errorOf(right.body).message).toMatch(/Too many wrong attempts/);
  });

  it('rejects an expired code', async () => {
    const phone = newPhone();
    await requestOtp(phone);
    const code = await sentCode(phone);
    await pool.query(
      `update otp_challenge set expires_at = now() - interval '1 second' where consumed_at is null`,
    );

    expect((await verify(phone, code)).status).toBe(401);
  });

  it('enforces the resend cooldown with 429 and Retry-After', async () => {
    const phone = newPhone();
    await requestOtp(phone);

    const again = await requestOtp(phone);

    expect(again.status).toBe(429);
    const error = errorOf(again.body);
    expect(error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(again.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
    expect(error.details).toEqual({ retryAfterSeconds: retryAfter });
  });

  it('rejects an invalid phone or a malformed device id', async () => {
    expect((await requestOtp('12345')).status).toBe(400);
    expect((await requestOtp(newPhone(), 'not-a-uuid')).status).toBe(400);
  });

  it('requires X-Device-Id on verify, since the session is bound to the device', async () => {
    const phone = newPhone();
    await requestOtp(phone);
    const code = await sentCode(phone);

    const res = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, role: 'customer' });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('OTP limits (cooldown switched off via config)', () => {
  beforeAll(async () => {
    const actor = { userId: await createUser(pool), role: 'super_admin' };
    await app.get(ConfigService).propose({
      key: 'auth.otp.resend_cooldown_seconds',
      value: 0,
      reason: 'test: isolate the window limits',
      actor,
    });
  });
  // Blocks may run in any order (vitest --sequence.shuffle), so put the launch defaults back.
  afterAll(() => resetSharedState(pool));

  it('allows 3 requests per phone per window, then 429', async () => {
    const phone = newPhone();

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await requestOtp(phone)).status);

    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('a new code replaces the previous one', async () => {
    const phone = newPhone();
    await requestOtp(phone);
    const first = await sentCode(phone);
    await requestOtp(phone);
    const second = await sentCode(phone);

    if (first !== second) expect((await verify(phone, first)).status).toBe(401);
    expect((await verify(phone, second)).status).toBe(200);
  });

  it('limits one device to 5 requests across different phones', async () => {
    const device = randomUUID();

    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await requestOtp(newPhone(), device)).status);

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
