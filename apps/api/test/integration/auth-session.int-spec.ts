import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { type EventEnvelope, errorBodySchema, type OtpVerifyResponse } from '@fixo/contracts';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { drizzle } from 'drizzle-orm/node-postgres';
import { decodeJwt, SignJWT } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { Actor } from '../../src/common/actor.js';
import { queuePrefix, redisOptions } from '../../src/common/redis.js';
import { RevokeSessionsOnRestriction } from '../../src/modules/auth/auth.consumers.js';
import { CurrentAuth } from '../../src/modules/auth/auth.guard.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import type { AuthContext } from '../../src/modules/auth/sessions.service.js';
import { ConfigService } from '../../src/modules/config/config.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { DomainEventsWorker } from '../../src/platform/outbox/domain-events.worker.js';
import { type OtpSmsJob, SMS_QUEUE_NAME } from '../../src/platform/sms/sms.js';
import { createUser, newPhone, resetSharedState, sentCode } from './helpers.js';

// A protected route (no @Public), standing in for every authenticated endpoint to come.
@Controller('test-auth')
class ProtectedController {
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return auth;
  }
}

let app: INestApplication;
let server: Server;
let smsQueue: Queue<OtpSmsJob>;
let admin: Actor;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, casing: 'snake_case' });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProtectedController],
  }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
  smsQueue = new Queue(SMS_QUEUE_NAME, { connection: redisOptions(), prefix: queuePrefix });

  // Many logins from one test IP: lift the OTP limits that are not under test here.
  admin = { userId: await createUser(pool), role: 'super_admin' };
  const config = app.get(ConfigService);
  const limit = { max: 1000, windowSeconds: 600 };
  for (const [key, value] of [
    ['auth.otp.limit_per_ip', limit],
    ['auth.otp.limit_per_phone', limit],
    ['auth.otp.resend_cooldown_seconds', 0],
  ] as const) {
    await config.propose({ key, value, reason: 'test: many logins', actor: admin });
  }
});

afterAll(async () => {
  await resetSharedState(pool);
  await smsQueue.close();
  await app.close();
  await pool.end();
});

interface Login extends OtpVerifyResponse {
  phone: string;
  device: string;
}

async function login(role = 'customer', phone = newPhone(), device = randomUUID()): Promise<Login> {
  await request(server).post('/v1/auth/otp/request').send({ phone }).expect(202);
  const code = await sentCode(smsQueue, phone);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .set('X-Device-Id', device)
    .send({ phone, code, role });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return { ...(res.body as OtpVerifyResponse), phone, device };
}

const me = (accessToken?: string) => {
  const req = request(server).get('/v1/test-auth/me');
  return accessToken ? req.set('Authorization', `Bearer ${accessToken}`) : req;
};
const refresh = (refreshToken: string, device: string) =>
  request(server).post('/v1/auth/refresh').set('X-Device-Id', device).send({ refreshToken });
const codeOf = (body: unknown) => errorBodySchema.parse(body).error.code;
const sessionIdOf = (accessToken: string) => decodeJwt(accessToken).sid as string;
const suspend = (userId: string, to: 'suspended' | 'blocked' | 'active' = 'suspended') =>
  app.get(UsersService).transitionStatus({ userId, to, actor: admin, reason: 'test' });

describe('access tokens', () => {
  it('authenticate requests as the role that logged in', async () => {
    const session = await login('worker');

    const res = await me(session.tokens.accessToken);

    expect(session.tokens.accessTokenExpiresIn).toBe(900);
    expect(session.activeRole).toBe('worker');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: session.userId,
      role: 'worker',
      sessionId: sessionIdOf(session.tokens.accessToken),
    });
  });

  it('reject missing, malformed, forged and expired tokens', async () => {
    const session = await login();
    const sid = sessionIdOf(session.tokens.accessToken);
    const sign = (secret: string, exp: number) =>
      new SignJWT({ sid, role: 'customer' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(session.userId)
        .setIssuer('fixo-api')
        .setAudience('fixo-app')
        .setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret));
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    const forged = await sign('an-attacker-guessed-secret-00000000000', inAnHour);
    const expired = await sign(process.env.JWT_SECRET ?? '', Math.floor(Date.now() / 1000) - 60);

    for (const token of [undefined, 'garbage', forged, expired]) {
      const res = await me(token);
      expect(res.status).toBe(401);
      expect(codeOf(res.body)).toBe('UNAUTHENTICATED');
    }
  });
});

describe('refresh tokens', () => {
  it('rotate: each refresh returns a new pair that works', async () => {
    const session = await login();

    const res = await refresh(session.tokens.refreshToken, session.device);

    expect(res.status).toBe(200);
    const next = res.body as { accessToken: string; refreshToken: string };
    expect(next.refreshToken).not.toBe(session.tokens.refreshToken);
    expect((await me(next.accessToken)).status).toBe(200);
  });

  it('end the whole session when an old token is reused (theft signal)', async () => {
    const session = await login();
    const r1 = session.tokens.refreshToken;
    const second = (await refresh(r1, session.device)).body as {
      accessToken: string;
      refreshToken: string;
    };

    const reuse = await refresh(r1, session.device);

    expect(reuse.status).toBe(401);
    expect(codeOf(reuse.body)).toBe('SESSION_EXPIRED');
    expect((await refresh(second.refreshToken, session.device)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(401);
  });

  it('are refused from another device, which also ends the session', async () => {
    const session = await login();

    const stolen = await refresh(session.tokens.refreshToken, randomUUID());
    const owner = await refresh(session.tokens.refreshToken, session.device);

    expect(stolen.status).toBe(401);
    expect(owner.status).toBe(401);
  });

  it('stop working once the session has been idle too long', async () => {
    const session = await login();
    await pool.query(
      `update session set idle_expires_at = now() - interval '1 second' where id = $1`,
      [sessionIdOf(session.tokens.accessToken)],
    );

    const res = await refresh(session.tokens.refreshToken, session.device);

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('SESSION_EXPIRED');
  });
});

describe('logout', () => {
  it('ends the session on the next request, and is safe to repeat', async () => {
    const session = await login();
    const out = () =>
      request(server).post('/v1/auth/logout').send({ refreshToken: session.tokens.refreshToken });

    expect((await out()).status).toBe(204);

    expect((await me(session.tokens.accessToken)).status).toBe(401);
    expect((await refresh(session.tokens.refreshToken, session.device)).status).toBe(401);
    expect((await out()).status).toBe(204);
  });
});

describe('account restrictions', () => {
  it('apply on the very next request, before any background consumer runs', async () => {
    const session = await login();

    await suspend(session.userId);

    const res = await me(session.tokens.accessToken);
    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('ACCOUNT_RESTRICTED');
    expect(codeOf((await refresh(session.tokens.refreshToken, session.device)).body)).toBe(
      'ACCOUNT_RESTRICTED',
    );
  });

  it('stop a blocked account from logging in', async () => {
    const first = await login();
    await suspend(first.userId, 'blocked');

    await expect(login('customer', first.phone)).rejects.toThrow(/ACCOUNT_RESTRICTED/);
  });

  it('revoke every session through the jobs consumer, exactly once', async () => {
    const phone = newPhone();
    const phoneLogin = await login('customer', phone);
    const workerLogin = await login('worker', phone);
    await suspend(phoneLogin.userId);
    const { rows } = await pool.query<{
      id: string;
      type: string;
      aggregate_type: string;
      aggregate_id: string;
      occurred_at: Date;
      payload: Record<string, unknown>;
    }>(`select * from outbox_event where aggregate_id = $1 and type = 'user.status_changed'`, [
      phoneLogin.userId,
    ]);
    const row = rows[0];
    if (!row) throw new Error('no user.status_changed event');
    const event: EventEnvelope = {
      id: row.id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      occurredAt: row.occurred_at.toISOString(),
      payload: row.payload,
    };
    const worker = new DomainEventsWorker(db, [
      new RevokeSessionsOnRestriction(new AuthRepository()),
    ]);

    await worker.dispatch(event);
    await worker.dispatch(event); // redelivery

    const sessions = await pool.query<{ revoke_reason: string | null }>(
      'select revoke_reason from session where user_id = $1',
      [phoneLogin.userId],
    );
    expect(sessions.rows.map((s) => s.revoke_reason)).toEqual([
      'account_suspended',
      'account_suspended',
    ]);
    const processed = await pool.query(
      `select 1 from processed_event where event_id = $1 and consumer = $2`,
      [event.id, 'auth.revoke_sessions_on_restriction'],
    );
    expect(processed.rowCount).toBe(1);

    // Restoring the account does not bring old sessions back: the user logs in again.
    await suspend(phoneLogin.userId, 'active');
    expect((await refresh(workerLogin.tokens.refreshToken, workerLogin.device)).status).toBe(401);
  });
});
