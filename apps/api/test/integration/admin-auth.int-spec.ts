import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema } from '@fixo/contracts';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AdminAuthService } from '../../src/modules/auth/admin-auth.service.js';
import { CurrentAuth } from '../../src/modules/auth/auth.guard.js';
import { timeStep, totpAt } from '../../src/modules/auth/domain/totp.js';
import type { AuthContext } from '../../src/modules/auth/sessions.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { resetSharedState } from './helpers.js';

@Controller('test-admin')
class ProtectedController {
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return auth;
  }
}

const SYSTEM = { userId: '00000000-0000-0000-0000-000000000001', role: 'system' };
let app: INestApplication;
let server: Server;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProtectedController],
  }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await resetSharedState(pool); // MFA attempt counters live in Redis
  await app.close();
  await pool.end();
});

async function newAdmin(roles = ['super_admin']) {
  const email = `admin-${randomUUID()}@fixo.test`;
  const created = await app.get(AdminAuthService).createAdmin({
    email,
    displayName: 'Test Admin',
    roleCodes: roles,
    actor: SYSTEM,
    reason: 'integration test',
  });
  return { email, ...created };
}

const login = (email: string, password: string) =>
  request(server).post('/v1/admin/auth/login').send({ email, password });
const mfa = (mfaToken: string, code: string) =>
  request(server).post('/v1/admin/auth/mfa').send({ mfaToken, code });
/** The authenticator-app code, `offset` 30-second steps from now (the server accepts ±1). */
const code = (secret: string, offset = 0) => totpAt(secret, timeStep(Date.now()) + offset);
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

function setCookies(res: Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}
function cookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const cookie of setCookies(res)) {
    const [name = '', value = ''] = (cookie.split(';')[0] ?? '').split('=');
    jar[name] = value;
  }
  return jar;
}
// Cookies are Secure, so they are passed by hand rather than through a cookie jar over http.
const cookieHeader = (jar: Record<string, string>) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

/** First login: password, enrol MFA, verify. Returns the session response and cookies. */
async function enrolAndLogin(admin: { email: string; password: string }) {
  const step1 = await login(admin.email, admin.password);
  const { mfaToken, secret } = step1.body as { mfaToken: string; secret: string };
  const step2 = await mfa(mfaToken, code(secret));
  return { step1, step2, secret, jar: cookies(step2) };
}

describe('admin login with mandatory MFA', () => {
  it('enrols MFA on first login, then only asks for a code', async () => {
    const admin = await newAdmin();

    const { step1, step2, secret } = await enrolAndLogin(admin);

    expect(step1.status).toBe(200);
    expect((step1.body as { stage: string }).stage).toBe('enroll');
    expect((step1.body as { secret: string }).secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((step1.body as { otpauthUrl: string }).otpauthUrl).toContain(
      encodeURIComponent(admin.email),
    );
    expect(step2.status).toBe(200);
    expect(step2.body).toMatchObject({
      userId: admin.userId,
      adminRoles: ['super_admin'],
      accessTokenExpiresIn: 900,
    });
    expect(step2.body).not.toHaveProperty('refreshToken'); // only in the httpOnly cookie

    const again = await login(admin.email, admin.password);
    expect(Object.keys(again.body as object).toSorted()).toEqual(['mfaToken', 'stage']);
    expect((again.body as { stage: string }).stage).toBe('verify'); // no secret is shown again
    const { mfaToken } = again.body as { mfaToken: string };
    expect((await mfa(mfaToken, code(secret, 1))).status).toBe(200);
  });

  it('sets hardened cookies and a 30 min idle / 12 h session', async () => {
    const { step2 } = await enrolAndLogin(await newAdmin());

    const raw = setCookies(step2);
    const refresh = raw.find((c) => c.startsWith('fixo_admin_rt='));
    const csrf = raw.find((c) => c.startsWith('fixo_csrf='));
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Secure/);
    expect(refresh).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/Path=\/v1\/admin\/auth/);
    expect(csrf).not.toMatch(/HttpOnly/); // the admin app must read it to echo it

    const { accessToken } = step2.body as { accessToken: string };
    const me = await request(server)
      .get('/v1/test-admin/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.body).toMatchObject({ role: 'admin' });
    const { rows } = await pool.query<{ idle: number; max: number }>(
      `select extract(epoch from idle_expires_at - created_at) as idle,
              extract(epoch from absolute_expires_at - created_at) as max
       from session where id = $1`,
      [(me.body as { sessionId: string }).sessionId],
    );
    expect(Math.round(Number(rows[0]?.idle) / 60)).toBe(30);
    expect(Math.round(Number(rows[0]?.max) / 3600)).toBe(12);
  });

  it('audits the creation of an admin account', async () => {
    const admin = await newAdmin(['finance']);

    const { rows } = await pool.query(
      `select action, reason, after from audit_log where entity_id = $1`,
      [admin.userId],
    );
    expect(rows).toEqual([
      { action: 'user.admin_created', reason: 'integration test', after: { roles: ['finance'] } },
    ]);
  });
});

describe('password checks', () => {
  it('answer wrong password and unknown email identically', async () => {
    const admin = await newAdmin();

    const wrong = await login(admin.email, 'not-the-password');
    const unknown = await login(`nobody-${randomUUID()}@fixo.test`, 'not-the-password');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (r: Response) => ({ ...errorOf(r.body), requestId: undefined });
    expect(strip(wrong)).toEqual(strip(unknown));
    expect(errorOf(wrong.body).code).toBe('INVALID_CREDENTIALS');
  });

  it('lock the account after 5 failures, even against the right password, until it expires', async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 5; i++) await login(admin.email, 'wrong-password');

    const whileLocked = await login(admin.email, admin.password);
    await pool.query(
      `update admin_credential set locked_until = now() - interval '1 second' where user_id = $1`,
      [admin.userId],
    );
    const afterLockout = await login(admin.email, admin.password);

    expect(whileLocked.status).toBe(401);
    expect(errorOf(whileLocked.body).code).toBe('INVALID_CREDENTIALS');
    expect(afterLockout.status).toBe(200);
  });

  it('refuse a blocked admin', async () => {
    const admin = await newAdmin();
    await app.get(UsersService).transitionStatus({
      userId: admin.userId,
      to: 'blocked',
      actor: SYSTEM,
      reason: 'test',
    });

    const res = await login(admin.email, admin.password);

    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe('ACCOUNT_RESTRICTED');
  });
});

describe('MFA codes', () => {
  it('reject a wrong code and a replayed code', async () => {
    const admin = await newAdmin();
    const step1 = await login(admin.email, admin.password);
    const { mfaToken, secret } = step1.body as { mfaToken: string; secret: string };
    const valid = code(secret);
    const wrong = valid === '000000' ? '111111' : '000000';

    expect((await mfa(mfaToken, wrong)).status).toBe(401);
    expect((await mfa(mfaToken, valid)).status).toBe(200);

    const next = (await login(admin.email, admin.password)).body as { mfaToken: string };
    const replay = await mfa(next.mfaToken, valid);
    expect(replay.status).toBe(401);
    expect(errorOf(replay.body).code).toBe('MFA_INVALID');
  });

  it('end the login attempt after 5 wrong codes', async () => {
    const admin = await newAdmin();
    const step1 = await login(admin.email, admin.password);
    const { mfaToken, secret } = step1.body as { mfaToken: string; secret: string };
    const valid = code(secret);
    const wrong = valid === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await mfa(mfaToken, wrong);

    const res = await mfa(mfaToken, valid);

    expect(res.status).toBe(401);
    expect(errorOf(res.body).message).toMatch(/Too many wrong codes/);
  });

  it('keep MFA tokens and access tokens apart', async () => {
    const admin = await newAdmin();
    const step1 = await login(admin.email, admin.password);
    const { mfaToken, secret } = step1.body as { mfaToken: string; secret: string };
    const step2 = await mfa(mfaToken, code(secret));
    const { accessToken } = step2.body as { accessToken: string };

    const mfaAsAccess = await request(server)
      .get('/v1/test-admin/me')
      .set('Authorization', `Bearer ${mfaToken}`);
    const accessAsMfa = await mfa(accessToken, code(secret, 1));

    expect(mfaAsAccess.status).toBe(401);
    expect(accessAsMfa.status).toBe(401);
  });
});

describe('admin session cookies', () => {
  const refresh = (jar: Record<string, string>, csrf?: string) => {
    const req = request(server).post('/v1/admin/auth/refresh').set('Cookie', cookieHeader(jar));
    return csrf === undefined ? req : req.set('X-CSRF-Token', csrf);
  };

  it('refresh needs the CSRF header, and rotates the refresh cookie', async () => {
    const { jar } = await enrolAndLogin(await newAdmin());
    const csrf = jar.fixo_csrf ?? '';

    const noHeader = await refresh(jar);
    const wrongHeader = await refresh(jar, 'forged');
    const ok = await refresh(jar, csrf);

    expect(noHeader.status).toBe(403);
    expect(errorOf(noHeader.body).code).toBe('CSRF_FAILED');
    expect(wrongHeader.status).toBe(403);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body as object).toSorted()).toEqual([
      'accessToken',
      'accessTokenExpiresIn',
    ]);
    expect((ok.body as { accessTokenExpiresIn: number }).accessTokenExpiresIn).toBe(900);
    const rotated = cookies(ok).fixo_admin_rt;
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(jar.fixo_admin_rt);
    // The old refresh cookie is spent: presenting it again ends the session (theft signal).
    expect((await refresh(jar, csrf)).status).toBe(401);
  });

  it('logout ends the session and clears the cookies', async () => {
    const { jar } = await enrolAndLogin(await newAdmin());
    const csrf = jar.fixo_csrf ?? '';

    const out = await request(server)
      .post('/v1/admin/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', csrf);

    expect(out.status).toBe(204);
    expect(setCookies(out).filter((c) => c.includes('Expires=Thu, 01 Jan 1970'))).toHaveLength(3);
    expect((await refresh(jar, csrf)).status).toBe(401);
  });
});
