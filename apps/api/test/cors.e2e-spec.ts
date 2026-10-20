import { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// vitest.config.ts sets CORS_ORIGINS=http://localhost:8082 (an Expo web dev server).
describe('CORS (spec §T: strict allow-list)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string) =>
    request(server)
      .options('/v1/auth/otp/request')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-device-id');

  it('answers the browser preflight for an allowed origin', async () => {
    const res = await preflight('http://localhost:8082');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8082');
    expect(res.headers['access-control-allow-headers']).toMatch(/x-device-id/i);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives no CORS permission to any other website', async () => {
    const res = await preflight('https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the headers apps need to read', async () => {
    const res = await request(server).get('/v1/health').set('Origin', 'http://localhost:8082');

    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/);
    expect(res.headers['access-control-expose-headers']).toMatch(/Retry-After/);
  });

  it('does not affect requests without an Origin (native apps, curl)', async () => {
    const res = await request(server).get('/v1/health');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).not.toBe(404);
  });
});
