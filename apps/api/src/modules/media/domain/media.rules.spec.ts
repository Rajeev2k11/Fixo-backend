import { describe, expect, it } from 'vitest';

import { sniffImageType } from './media.rules.js';

const bytes = (...values: number[]) => Buffer.from(values);

describe('sniffImageType', () => {
  it.each([
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), 'image/jpeg'],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'image/png'],
    ['WebP', Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'), 'image/webp'],
  ])('recognises %s by its bytes', (_name, start, type) => {
    expect(sniffImageType(start)).toBe(type);
  });

  it.each([
    ['a PDF', Buffer.from('%PDF-1.7')],
    ['an HTML page renamed .jpg', Buffer.from('<html><script>alert(1)</script>')],
    [
      'a RIFF file that is not WebP (WAV)',
      Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ', 'latin1'),
    ],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s', (_name, start) => {
    expect(sniffImageType(start)).toBeNull();
  });
});
