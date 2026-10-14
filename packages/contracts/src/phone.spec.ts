import { describe, expect, it } from 'vitest';

import { indianMobileSchema } from './phone.js';

describe('indianMobileSchema', () => {
  it.each(['9876543210', '98765 43210', '09876543210', '919876543210', '+91 98765-43210'])(
    'normalises %s to E.164',
    (input) => {
      expect(indianMobileSchema.parse(input)).toBe('+919876543210');
    },
  );

  it.each(['5876543210', '987654321', '98765432100', '+1 9876543210', 'abc'])(
    'rejects %s',
    (input) => {
      expect(indianMobileSchema.safeParse(input).success).toBe(false);
    },
  );
});
