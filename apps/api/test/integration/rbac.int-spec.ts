import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema } from '@fixo/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { SessionsService } from '../../src/modules/auth/sessions.service.js';
import { defineConfigKey } from '../../src/modules/config/config.keys.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { newPhone, resetSharedState } from './helpers.js';

const SYSTEM = { userId: '00000000-0000-0000-0000-000000000001', role: 'system' };
const RADIUS = defineConfigKey('matching.rbac_test_radius_km', z.number().positive());
const FEE = defineConfigKey('revenue.rbac_test_fee_paise', z.int().min(0), {
  requiresApproval: true,
});
const ADMIN_ROLES = ['super_admin', 'operations', 'verification', 'finance', 'support'] as const;
type Caller = (typeof ADMIN_ROLES)[number] | 'customer' | 'worker';

let app: INestApplication;
let server: Server;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tokens = {} as Record<Caller, { userId: string; token: string }>;

async function adminSession(roles: string[]) {
  const userId = await app.get(UsersService).createAdmin({
    email: `rbac-${randomUUID()}@fixo.test`,
    displayName: 'RBAC test',
    roleCodes: roles,
    actor: SYSTEM,
    reason: 'rbac test',
  });
  // Straight to a session: the password + MFA flow is covered in admin-auth.int-spec.
  const { accessToken } = await app.get(SessionsService).start(userId, 'admin', randomUUID());
  return { userId, token: accessToken };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  server = app.getHttpServer() as Server;

  for (const role of ADMIN_ROLES) tokens[role] = await adminSession([role]);
  for (const role of ['customer', 'worker'] as const) {
    const { userId } = await app.get(UsersService).findOrCreateByPhone(newPhone(), role);
    const { accessToken } = await app.get(SessionsService).start(userId, role, randomUUID());
    tokens[role] = { userId, token: accessToken };
  }
});

afterAll(async () => {
  await resetSharedState(pool);
  await app.close();
  await pool.end();
});

const as = (caller: Caller | { token: string }) =>
  `Bearer ${typeof caller === 'string' ? tokens[caller].token : caller.token}`;
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

describe('RBAC matrix: every admin route x every role', () => {
  const routes: {
    name: string;
    allowed: Caller[];
    call: (auth: string) => request.Test;
  }[] = [
    {
      name: 'GET /admin/config/rules',
      allowed: ['super_admin', 'operations', 'finance'],
      call: (auth) => request(server).get('/v1/admin/config/rules').set('Authorization', auth),
    },
    {
      name: 'POST /admin/config/rules',
      allowed: ['super_admin', 'operations'],
      call: (auth) =>
        request(server)
          .post('/v1/admin/config/rules')
          .set('Authorization', auth)
          .send({ key: RADIUS.name, value: 5, reason: 'rbac matrix' }),
    },
    {
      name: 'POST /admin/config/rules/:id/approve',
      allowed: ['super_admin', 'finance'],
      call: (auth) =>
        request(server)
          .post(`/v1/admin/config/rules/${randomUUID()}/approve`)
          .set('Authorization', auth)
          .send({ reason: 'rbac matrix' }),
    },
    {
      name: 'POST /admin/config/rules/:id/reject',
      allowed: [...ADMIN_ROLES],
      call: (auth) =>
        request(server)
          .post(`/v1/admin/config/rules/${randomUUID()}/reject`)
          .set('Authorization', auth)
          .send({ reason: 'rbac matrix' }),
    },
    {
      name: 'POST /admin/admins',
      allowed: ['super_admin'],
      call: (auth) =>
        request(server)
          .post('/v1/admin/admins')
          .set('Authorization', auth)
          .send({
            email: `new-${randomUUID()}@fixo.test`,
            displayName: 'New Admin',
            roleCodes: ['support'],
            reason: 'rbac matrix',
          }),
    },
    {
      name: 'PUT /admin/admins/:userId/roles',
      allowed: ['super_admin'],
      call: (auth) =>
        request(server)
          .put(`/v1/admin/admins/${tokens.support.userId}/roles`)
          .set('Authorization', auth)
          .send({ roleCodes: ['support'], reason: 'rbac matrix' }),
    },
  ];
  const callers: Caller[] = [...ADMIN_ROLES, 'customer', 'worker'];

  for (const route of routes) {
    it.each(callers)(`${route.name} as %s`, async (caller) => {
      const res = await route.call(as(caller));

      if (route.allowed.includes(caller)) {
        expect(res.status, JSON.stringify(res.body)).not.toBe(403);
        expect(res.status).toBeLessThan(500);
      } else {
        expect(res.status).toBe(403);
        expect(errorOf(res.body).code).toBe('FORBIDDEN');
      }
    });
  }
});

describe('config policy per key (spec §Y, SPEC-2)', () => {
  const propose = (caller: Caller | { token: string }, key: string, value: unknown) =>
    request(server)
      .post('/v1/admin/config/rules')
      .set('Authorization', as(caller))
      .send({ key, value, reason: 'policy test' });
  const approve = (caller: Caller | { token: string }, id: string) =>
    request(server)
      .post(`/v1/admin/config/rules/${id}/approve`)
      .set('Authorization', as(caller))
      .send({ reason: 'checked against the pricing sheet' });

  it('revenue: super admin proposes, a finance admin approves, nobody else can', async () => {
    const byOps = await propose('operations', FEE.name, 0);
    expect(byOps.status).toBe(403);

    const proposal = await propose('super_admin', FEE.name, 0);
    expect(proposal.status).toBe(201);
    const { id, status } = proposal.body as { id: string; status: string };
    expect(status).toBe('pending');

    expect(errorOf((await approve('super_admin', id)).body).code).toBe('MAKER_CANNOT_APPROVE');
    const otherSuperAdmin = await adminSession(['super_admin']);
    expect(errorOf((await approve(otherSuperAdmin, id)).body).code).toBe('FORBIDDEN');

    const approved = await approve('finance', id);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: tokens.finance.userId });

    const { rows } = await pool.query<{ action: string; actor_role: string }>(
      'select action, actor_role from audit_log where entity_id = $1 order by created_at',
      [id],
    );
    expect(rows).toEqual([
      { action: 'config.rule.proposed', actor_role: 'super_admin' },
      { action: 'config.rule.activated', actor_role: 'finance' },
    ]);
  });

  it('security settings (auth.*) are super admin only', async () => {
    expect((await propose('operations', 'auth.otp.length', 6)).status).toBe(403);
  });
});

describe('admin accounts', () => {
  it('an admin cannot change their own roles', async () => {
    const res = await request(server)
      .put(`/v1/admin/admins/${tokens.super_admin.userId}/roles`)
      .set('Authorization', as('super_admin'))
      .send({ roleCodes: ['support'], reason: 'locking myself out' });

    expect(res.status).toBe(403);
  });

  it('role changes are audited with before and after', async () => {
    const target = await adminSession(['support']);

    await request(server)
      .put(`/v1/admin/admins/${target.userId}/roles`)
      .set('Authorization', as('super_admin'))
      .send({ roleCodes: ['verification', 'support'], reason: 'Covering KYC queue' })
      .expect(204);

    const { rows } = await pool.query(
      `select before, after, reason from audit_log
       where entity_id = $1 and action = 'user.admin_roles_changed'`,
      [target.userId],
    );
    expect(rows).toEqual([
      {
        before: { roles: ['support'] },
        after: { roles: ['support', 'verification'] },
        reason: 'Covering KYC queue',
      },
    ]);
  });

  it('a new admin role takes effect on the next request', async () => {
    const target = await adminSession(['support']);
    const list = () =>
      request(server).get('/v1/admin/config/rules').set('Authorization', as(target));
    expect((await list()).status).toBe(403);

    await request(server)
      .put(`/v1/admin/admins/${target.userId}/roles`)
      .set('Authorization', as('super_admin'))
      .send({ roleCodes: ['finance'], reason: 'Moved to finance' })
      .expect(204);

    expect((await list()).status).toBe(200);
  });
});
