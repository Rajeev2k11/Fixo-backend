import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { errorBodySchema } from '@fixo/contracts';
import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';

const echoSchema = z.strictObject({ name: z.string().min(1) });

// Test-only routes; registered in the testing module, never in AppModule.
@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('db password is hunter2');
  }
}

describe('error shape, validation and request ids', () => {
  let app: INestApplication;
  let server: Server;

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
  });

  it('accepts a valid body', async () => {
    const res = await request(server).post('/v1/test/echo').send({ name: 'Asha' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'Asha' });
  });

  it('rejects unknown fields with VALIDATION_FAILED and the field path', async () => {
    const res = await request(server).post('/v1/test/echo').send({ name: 'Asha', price: 1 });

    expect(res.status).toBe(400);
    const { error } = errorBodySchema.parse(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(error.details)).toContain('price');
  });

  it('rejects a missing required field with the same shape', async () => {
    const res = await request(server).post('/v1/test/echo').send({});

    expect(res.status).toBe(400);
    const { error } = errorBodySchema.parse(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([expect.objectContaining({ path: 'name' })]);
  });

  it('rejects malformed JSON as a 400, not a 500', async () => {
    const res = await request(server)
      .post('/v1/test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
    expect(errorBodySchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns NOT_FOUND with a requestId matching the X-Request-Id header', async () => {
    const res = await request(server).get('/v1/nope');

    expect(res.status).toBe(404);
    const { error } = errorBodySchema.parse(res.body);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.requestId).toBe(res.headers['x-request-id']);
  });

  it('echoes a valid incoming X-Request-Id', async () => {
    const id = randomUUID();
    const res = await request(server).get('/v1/nope').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id);
    expect(errorBodySchema.parse(res.body).error.requestId).toBe(id);
  });

  it('replaces a non-UUID incoming X-Request-Id', async () => {
    const res = await request(server).get('/v1/nope').set('X-Request-Id', '"} fake log entry');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('turns an unexpected error into a generic 500 without leaking details', async () => {
    const res = await request(server).get('/v1/test/boom');

    expect(res.status).toBe(500);
    const { error } = errorBodySchema.parse(res.body);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
