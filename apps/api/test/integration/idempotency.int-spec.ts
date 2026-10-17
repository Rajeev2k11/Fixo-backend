import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { errorBodySchema } from '@fixo/contracts';
import { Body, Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { Idempotent } from '../../src/platform/idempotency/idempotency.interceptor.js';
import { Public } from '../../src/modules/auth/auth.guard.js';

let runs = 0;
let failNext = false;

// Test-only routes standing in for create-booking and friends.
@Public()
@Controller('test-idem')
class TestController {
  @Post('orders')
  @Idempotent()
  async create(@Body() body: { item: string }) {
    runs++;
    await sleep(50); // long enough for concurrent retries to overlap
    if (failNext) {
      failNext = false;
      throw new Error('downstream failure');
    }
    return { orderId: randomUUID(), item: body.item };
  }

  @Post('accept')
  @Idempotent()
  @HttpCode(200)
  accept() {
    runs++;
    return { accepted: true };
  }

  @Post('plain')
  plain() {
    return { ok: true };
  }
}

describe('Idempotency-Key handling', () => {
  let app: INestApplication;
  let server: Server;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(() => {
    runs = 0;
    failNext = false;
  });

  const order = (key: string | null, body: object = { item: 'ac-service' }) => {
    const req = request(server).post('/v1/test-idem/orders');
    return (key === null ? req : req.set('Idempotency-Key', key)).send(body);
  };

  it('requires the header on @Idempotent routes', async () => {
    const res = await order(null);

    expect(res.status).toBe(400);
    expect(errorBodySchema.parse(res.body).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(runs).toBe(0);
  });

  it('does not require the header elsewhere', async () => {
    const res = await request(server).post('/v1/test-idem/plain').send({});

    expect(res.status).toBe(201);
  });

  it('replays the stored response for a retry, without running the handler again', async () => {
    const key = randomUUID();

    const first = await order(key);
    const retry = await order(key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(runs).toBe(1);
  });

  it('replays the route status code, not just 201', async () => {
    const key = randomUUID();
    const send = () =>
      request(server).post('/v1/test-idem/accept').set('Idempotency-Key', key).send({});

    await send();
    const retry = await send();

    expect(retry.status).toBe(200);
    expect(runs).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = randomUUID();
    await order(key, { item: 'ac-service' });

    const res = await order(key, { item: 'plumbing' });

    expect(res.status).toBe(422);
    expect(errorBodySchema.parse(res.body).error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    expect(runs).toBe(1);
  });

  it('runs the handler once under 20 concurrent retries', async () => {
    const key = randomUUID();

    const responses = await Promise.all(Array.from({ length: 20 }, () => order(key)));

    expect(runs).toBe(1);
    // One request runs. The rest either overlapped it (409) or arrived after it finished
    // (a replay of the very same response).
    const [original, ...more] = responses.filter(
      (r) => r.status === 201 && r.headers['idempotent-replayed'] === undefined,
    );
    expect(original).toBeDefined();
    expect(more).toHaveLength(0);
    for (const r of responses.filter((x) => x !== original)) {
      if (r.status === 201) {
        expect(r.headers['idempotent-replayed']).toBe('true');
        expect(r.body).toEqual(original?.body);
      } else {
        expect(r.status).toBe(409);
        expect(errorBodySchema.parse(r.body).error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      }
    }
  });

  it('frees the key when the handler fails, so a retry runs', async () => {
    const key = randomUUID();
    failNext = true;

    const failed = await order(key);
    const retry = await order(key);

    expect(failed.status).toBe(500);
    expect(retry.status).toBe(201);
    expect(runs).toBe(2);
  });

  it('treats an expired key as new', async () => {
    const key = randomUUID();
    await order(key);
    await pool.query(
      `update idempotency_key set expires_at = now() - interval '1 second' where key = $1`,
      [key],
    );

    const again = await order(key);

    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(runs).toBe(2);
  });
});
