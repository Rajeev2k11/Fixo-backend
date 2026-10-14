import { randomUUID } from 'node:crypto';

import type { Params } from 'nestjs-pino';

import type { Env } from './env.js';

/**
 * Fields that must never reach the logs (CLAUDE.md: phones, OTPs, tokens, KYC, bank details).
 * pino wildcards match one level, so both the top-level and the nested form are listed.
 * Add new sensitive field names here as modules introduce them.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...['phone', 'otp', 'token', 'accessToken', 'refreshToken', 'password'].flatMap((field) => [
    field,
    `*.${field}`,
  ]),
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loggerParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Reuse a caller's X-Request-Id only if it is a UUID, so clients cannot inject log content.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && UUID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
    },
  };
}

/** For the rare log line that must identify a phone: "+91XXXXXX3210". */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}XXXXXX${phone.slice(-4)}`;
}
