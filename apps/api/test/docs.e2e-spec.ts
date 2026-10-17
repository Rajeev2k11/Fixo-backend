import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { OPENAPI_FILE } from '../src/cli/export-openapi.js';
import { buildOpenApiDocument } from '../src/modules/docs/openapi.js';

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/')}`;

/** Every "method /path" Nest actually serves (without the /v1 prefix). */
function registeredRoutes(app: INestApplication): string[] {
  const scanner = new MetadataScanner();
  return app
    .get(DiscoveryService)
    .getControllers()
    .flatMap(({ instance, metatype }) => {
      if (!instance || !metatype) return [];
      const base = Reflect.getMetadata(PATH_METADATA, metatype) as string;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      return scanner.getAllMethodNames(proto).flatMap((name) => {
        const handler = proto[name] as object;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) return [];
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        // Nest writes path params as :id, OpenAPI as {id}.
        const openApiPath = join(base, path).replace(/:(\w+)/g, '{$1}');
        return [`${RequestMethod[method].toLowerCase()} ${openApiPath}`];
      });
    });
}

function documentedRoutes(): string[] {
  const paths = buildOpenApiDocument().paths as Record<string, Record<string, unknown>>;
  return Object.entries(paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => `${method} ${path}`),
  );
}

describe('API docs', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every route the API serves, and nothing else', () => {
    const served = registeredRoutes(app).filter((r) => !r.includes(' /docs'));

    expect(documentedRoutes().toSorted()).toEqual(served.toSorted());
  });

  it('keeps the committed openapi.json in step with the code (run `pnpm openapi`)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as unknown;

    expect(committed).toEqual(buildOpenApiDocument());
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(server).get('/v1/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ openapi: '3.1.0', info: { title: 'FIXO API' } });
  });

  it('serves the Swagger UI page', async () => {
    const res = await request(server).get('/v1/docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/v1/docs/openapi.json');
  });
});

/**
 * Authorization review as a test: every route refuses a request without a token, except this
 * list. Adding a public route means adding it here, on purpose, in a reviewed diff.
 */
const PUBLIC_ROUTES = [
  'get /health',
  'get /docs',
  'get /docs/openapi.json',
  'post /auth/otp/request',
  'post /auth/otp/verify',
  'post /auth/refresh',
  'post /auth/logout',
  'post /admin/auth/login',
  'post /admin/auth/mfa',
  'post /admin/auth/refresh', // authenticated by its httpOnly cookie + CSRF header instead
  'post /admin/auth/logout',
];

describe('authorization surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('every route outside the public list answers 401 without a token', async () => {
    const server = app.getHttpServer() as Server;
    const results: string[] = [];
    for (const route of registeredRoutes(app)) {
      const [method = '', path = ''] = route.split(' ');
      const url = `/v1${path.replace(/\{\w+\}/g, randomUUID())}`;
      const res = await request(server)[method as 'get' | 'post' | 'put'](url).send({});
      const isPublic = PUBLIC_ROUTES.includes(route);
      const ok = isPublic ? res.status !== 401 : res.status === 401;
      if (!ok)
        results.push(`${route} -> ${String(res.status)} (${isPublic ? 'public' : 'protected'})`);
    }

    expect(results).toEqual([]);
  });

  it('the public list names only routes that exist', () => {
    const served = registeredRoutes(app);
    expect(PUBLIC_ROUTES.filter((r) => !served.includes(r))).toEqual([]);
  });
});
