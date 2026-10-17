import {
  configRuleSchema,
  createAdminResponseSchema,
  createAdminSchema,
  decideConfigSchema,
  proposeConfigSchema,
  setAdminRolesSchema,
  adminAccessResponseSchema,
  adminLoginResponseSchema,
  adminLoginSchema,
  adminMfaSchema,
  adminSessionResponseSchema,
  errorBodySchema,
  logoutRequestSchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifyResponseSchema,
  otpVerifySchema,
  refreshRequestSchema,
  tokenPairSchema,
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

/** For routes behind an access token, optionally limited to admin roles. */
const secured = (adminRoles?: string) => ({
  security: [{ bearerAuth: [] }],
  ...(adminRoles && { 'x-admin-roles': adminRoles }),
});
const authErrors = {
  '401': error('Missing, invalid or expired access token: refresh it', ['UNAUTHENTICATED']),
  '403': error('Role not allowed, or account restricted', ['FORBIDDEN', 'ACCOUNT_RESTRICTED']),
};
const idParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});

const deviceIdHeader = (required: boolean, description: string) => ({
  name: 'X-Device-Id',
  in: 'header',
  required,
  description,
  schema: { type: 'string', format: 'uuid' },
});
const BOUND_DEVICE = 'App-generated install id (UUID). The session is bound to it.';
const csrfHeader = {
  name: 'X-CSRF-Token',
  in: 'header',
  required: true,
  description: 'Must equal the fixo_csrf cookie (double-submit CSRF protection)',
  schema: { type: 'string' },
};

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
    tags: [
      { name: 'auth', description: 'Phone OTP login (customers and workers)' },
      { name: 'admin-config', description: 'Versioned business configuration (spec §Y 9-11)' },
      { name: 'admin-accounts', description: 'Admin accounts and roles (spec §Y 21)' },
      {
        name: 'admin-auth',
        description:
          'Admin web login: email + password, then mandatory TOTP MFA. The refresh token is an ' +
          'httpOnly cookie; refresh and logout need X-CSRF-Token equal to the fixo_csrf cookie.',
      },
    ],
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
            deviceIdHeader(false, 'App-generated install id (UUID); enables the per-device limit'),
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
          description:
            'Returns the session tokens. Send the access token as "Authorization: Bearer <token>".',
          parameters: [deviceIdHeader(true, BOUND_DEVICE)],
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
            '403': error('Account suspended or blocked', ['ACCOUNT_RESTRICTED']),
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['auth'],
          summary: 'Exchange the refresh token for a new token pair',
          description:
            'Refresh tokens are single use. Never run two refreshes in parallel: presenting a ' +
            'token twice is treated as theft and ends the session.',
          parameters: [deviceIdHeader(true, BOUND_DEVICE)],
          requestBody: { required: true, content: json(input(refreshRequestSchema)) },
          responses: {
            '200': { description: 'New tokens', content: json(output(tokenPairSchema)) },
            '400': validationFailed,
            '401': error('Session expired, revoked, reused or wrong device: log in again', [
              'SESSION_EXPIRED',
            ]),
            '403': error('Account suspended or blocked', ['ACCOUNT_RESTRICTED']),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['auth'],
          summary: 'End the session (works even with an expired access token)',
          requestBody: { required: true, content: json(input(logoutRequestSchema)) },
          responses: { '204': { description: 'Logged out' }, '400': validationFailed },
        },
      },
      '/admin/auth/login': {
        post: {
          tags: ['admin-auth'],
          summary: 'Step 1: email and password',
          description:
            'Returns a 5-minute mfaToken. On first login (stage "enroll") it also returns a TOTP ' +
            'secret and otpauth URL to add to an authenticator app.',
          requestBody: { required: true, content: json(input(adminLoginSchema)) },
          responses: {
            '200': { description: 'Password accepted', content: json(output(adminLoginResponseSchema)) },
            '400': validationFailed,
            '401': error('Wrong email or password, or account locked (same answer for all)', [
              'INVALID_CREDENTIALS',
            ]),
            '403': error('Account suspended or blocked', ['ACCOUNT_RESTRICTED']),
          },
        },
      },
      '/admin/auth/mfa': {
        post: {
          tags: ['admin-auth'],
          summary: 'Step 2: TOTP code; starts the session',
          description:
            'Sets the fixo_admin_rt and fixo_admin_device (httpOnly) and fixo_csrf cookies. Keep ' +
            'the access token in memory only.',
          requestBody: { required: true, content: json(input(adminMfaSchema)) },
          responses: {
            '200': { description: 'Logged in', content: json(output(adminSessionResponseSchema)) },
            '400': validationFailed,
            '401': error('Wrong or replayed code, too many attempts, or expired mfaToken', [
              'MFA_INVALID',
            ]),
            '403': error('Account suspended or blocked', ['ACCOUNT_RESTRICTED']),
          },
        },
      },
      '/admin/auth/refresh': {
        post: {
          tags: ['admin-auth'],
          summary: 'New access token from the refresh cookie (rotates the cookie)',
          parameters: [csrfHeader],
          responses: {
            '200': { description: 'New access token', content: json(output(adminAccessResponseSchema)) },
            '401': error('Session expired: log in again', ['SESSION_EXPIRED']),
            '403': error('CSRF check failed, or account restricted', ['CSRF_FAILED', 'ACCOUNT_RESTRICTED']),
          },
        },
      },
      '/admin/auth/logout': {
        post: {
          tags: ['admin-auth'],
          summary: 'End the admin session and clear its cookies',
          parameters: [csrfHeader],
          responses: {
            '204': { description: 'Logged out' },
            '403': error('CSRF check failed', ['CSRF_FAILED']),
          },
        },
      },
      '/admin/config/rules': {
        get: {
          tags: ['admin-config'],
          summary: 'List config versions (newest first), e.g. ?status=pending for approvals',
          ...secured('super_admin, operations, finance'),
          parameters: [
            { name: 'key', in: 'query', required: false, schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            },
          ],
          responses: {
            '200': { description: 'Versions', content: json({ type: 'array', items: output(configRuleSchema) }) },
            ...authErrors,
          },
        },
        post: {
          tags: ['admin-config'],
          summary: 'Propose a new version of a config value',
          description:
            'Per key: revenue.* and auth.* only super admin; others super admin or operations. ' +
            'Keys needing approval (revenue) stay pending until a finance admin approves.',
          ...secured('super_admin, operations (narrowed per key)'),
          requestBody: { required: true, content: json(input(proposeConfigSchema)) },
          responses: {
            '201': { description: 'Created (approved, or pending approval)', content: json(output(configRuleSchema)) },
            '400': error('Invalid body, unknown key, or value fails the key schema', [
              'VALIDATION_FAILED',
              'CONFIG_KEY_UNKNOWN',
            ]),
            '409': error('Overlaps an already scheduled version', ['CONFIG_OVERLAP']),
            ...authErrors,
          },
        },
      },
      '/admin/config/rules/{id}/approve': {
        post: {
          tags: ['admin-config'],
          summary: 'Approve a pending version (a different admin than the proposer)',
          ...secured('finance (per key policy)'),
          parameters: [idParam('id')],
          requestBody: { required: true, content: json(input(decideConfigSchema)) },
          responses: {
            '200': { description: 'Approved and in force from effectiveFrom', content: json(output(configRuleSchema)) },
            '404': error('No such version', ['NOT_FOUND']),
            '409': error('Not pending, or overlaps a scheduled version', ['CONFIG_NOT_PENDING', 'CONFIG_OVERLAP']),
            ...authErrors,
            '403': error('Role not allowed, or the proposer approving their own change', [
              'FORBIDDEN',
              'MAKER_CANNOT_APPROVE',
            ]),
          },
        },
      },
      '/admin/config/rules/{id}/reject': {
        post: {
          tags: ['admin-config'],
          summary: 'Reject a pending version (approvers), or withdraw your own proposal',
          ...secured('any admin role (checked per key)'),
          parameters: [idParam('id')],
          requestBody: { required: true, content: json(input(decideConfigSchema)) },
          responses: {
            '200': { description: 'Rejected', content: json(output(configRuleSchema)) },
            '404': error('No such version', ['NOT_FOUND']),
            '409': error('Not pending', ['CONFIG_NOT_PENDING']),
            ...authErrors,
          },
        },
      },
      '/admin/admins': {
        post: {
          tags: ['admin-accounts'],
          summary: 'Create an admin; returns a one-time password',
          ...secured('super_admin'),
          requestBody: { required: true, content: json(input(createAdminSchema)) },
          responses: {
            '201': { description: 'Created', content: json(output(createAdminResponseSchema)) },
            '400': validationFailed,
            ...authErrors,
          },
        },
      },
      '/admin/admins/{userId}/roles': {
        put: {
          tags: ['admin-accounts'],
          summary: "Replace an admin's roles (not your own)",
          ...secured('super_admin'),
          parameters: [idParam('userId')],
          requestBody: { required: true, content: json(input(setAdminRolesSchema)) },
          responses: {
            '204': { description: 'Roles replaced' },
            '400': validationFailed,
            '404': error('Not an admin', ['NOT_FOUND']),
            ...authErrors,
          },
        },
      },
    },
    components: {
      schemas: { ErrorBody: output(errorBodySchema) },
      // Protected routes (from Phase 2) declare `security: [{ bearerAuth: [] }]`. Their 401 is
      // UNAUTHENTICATED (refresh the token) and 403 ACCOUNT_RESTRICTED.
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  };
}
