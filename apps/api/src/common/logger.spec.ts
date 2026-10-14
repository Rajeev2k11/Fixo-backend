import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { maskPhone, REDACT_PATHS } from './logger.js';

function capture(): { logger: pino.Logger; output: () => string } {
  let buffer = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      buffer += chunk.toString();
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
  return { logger, output: () => buffer };
}

describe('log redaction', () => {
  it('never writes phones, OTPs, tokens or auth headers', () => {
    const { logger, output } = capture();

    logger.info({
      phone: '+919876543210',
      body: { otp: '482913', refreshToken: 'rt-secret' },
      req: { headers: { authorization: 'Bearer at-secret', cookie: 'sid=abc' } },
    });

    const line = output();
    for (const secret of ['9876543210', '482913', 'rt-secret', 'at-secret', 'sid=abc']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });
});

describe('maskPhone', () => {
  it('keeps only the country code and last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91XXXXXX3210');
  });
});
