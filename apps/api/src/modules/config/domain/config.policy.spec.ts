import { describe, expect, it } from 'vitest';

import { configPolicy, holdsAnyRole } from './config.policy.js';

describe('configPolicy (spec §Y)', () => {
  it.each([
    ['revenue.lead_fee_paise', ['super_admin'], ['finance']],
    ['auth.otp.length', ['super_admin'], ['super_admin']],
    ['matching.lead_cap', ['super_admin', 'operations'], ['finance']],
    ['pricing.visit_fee_cap', ['super_admin', 'operations'], ['finance']],
  ])('%s', (key, propose, approve) => {
    expect(configPolicy(key)).toEqual({ propose, approve });
  });
});

describe('holdsAnyRole', () => {
  it('matches any of an admin’s comma-separated roles', () => {
    expect(holdsAnyRole('support,finance', ['finance'])).toBe(true);
    expect(holdsAnyRole('support', ['finance', 'super_admin'])).toBe(false);
  });
});
