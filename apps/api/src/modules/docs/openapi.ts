import {
  errorBodySchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifyResponseSchema,
  otpVerifySchema,
} from '@fixo/contracts';
import { z } from 'zod';

/**
 * The OpenAPI 3.1 contract, built from the same Zod schemas the API validates with and the
 * mobile apps import, so the docs cannot describe a different shape than the code enforces.
 * docs.spec.ts fails if a route exists without an entry here.
 */

// Request bodies are documented as clients send them (before transforms like phone normalisation).
const input = (schema: z.ZodType) => strip(z.toJSONSchema(schema, { io: 'input' }));
const output = (schema: z.ZodType) => strip(z.toJSONSchema(schema, { io: 'output' }));

// Embedded schemas inherit the document's dialect, so the per-schema $schema key is dropped.
function strip(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...jsonSchema };
  delete copy.$schema;
  return copy;
}

const json = (schema: Record<string, unknown>, example?: unknown) => ({
  'application/json': { schema, ...(example !== undefined && { example }) },
});

/** An error response; `codes` lists the error.code values a client should expect. */
const error = (description: string, codes: string[]) => ({
  description: `${description}. error.code: ${codes.join(', ')}`,
  content: json({ $ref: '#/components/schemas/ErrorBody' }),
});

const validationFailed = error('Body or header failed validation', ['VALIDATION_FAILED']);

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FIXO API',
      version: 'v1',
      description:
        'Home-services marketplace API. Every error uses the ErrorBody shape; clients switch on ' +
        'error.code (stable), never on error.message. Send X-Request-Id (UUID) to correlate logs.',
    },
    servers: [{ url: '/v1' }],
    tags: [{ name: 'auth', description: 'Phone OTP login (customers and workers)' }],
    paths: {
      '/health': {
        get: {
          summary: 'Liveness and dependency check',
          responses: {
            '200': {
              description: 'API, database and Redis are up',
              content: json(output(z.strictObject({ status: z.literal('ok') }))),
            },
            '503': error('A dependency is down (see details)', ['SERVICE_UNAVAILABLE']),
          },
        },
      },
      '/auth/otp/request': {
        post: {
          tags: ['auth'],
          summary: 'Send a login OTP by SMS',
          description:
            'Same response whether or not the number has an account. In development the code is ' +
            'printed in the jobs process output (FakeSms).',
          parameters: [
            {
              name: 'X-Device-Id',
              in: 'header',
              required: false,
              description: 'App-generated install id (UUID); enables the per-device limit',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: json(input(otpRequestSchema), { phone: '9876543210' }),
          },
          responses: {
            '202': {
              description: 'OTP queued for sending',
              content: json(output(otpRequestResponseSchema), {
                expiresInSeconds: 300,
                resendAfterSeconds: 30,
              }),
            },
            '400': validationFailed,
            '429': {
              ...error('Too many requests; also sent as the Retry-After header', ['RATE_LIMITED']),
              headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds' } },
            },
          },
        },
      },
      '/auth/otp/verify': {
        post: {
          tags: ['auth'],
          summary: 'Verify the OTP and log in (creates the account on first login)',
          description: 'Step 1.10 adds access and refresh tokens to the response.',
          requestBody: {
            required: true,
            content: json(input(otpVerifySchema), {
              phone: '9876543210',
              code: '123456',
              role: 'customer',
            }),
          },
          responses: {
            '200': {
              description: 'Logged in',
              content: json(output(otpVerifyResponseSchema)),
            },
            '400': validationFailed,
            '401': error('Wrong, expired, used or locked code', ['OTP_INVALID']),
          },
        },
      },
    },
    components: { schemas: { ErrorBody: output(errorBodySchema) } },
  };
}
