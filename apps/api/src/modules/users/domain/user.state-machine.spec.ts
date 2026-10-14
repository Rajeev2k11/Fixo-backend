import { describe, expect, it } from 'vitest';

import { canTransition, USER_STATUSES, type UserStatus } from './user.state-machine.js';

const ALLOWED: [UserStatus, UserStatus][] = [
  ['active', 'suspended'],
  ['active', 'blocked'],
  ['suspended', 'active'],
  ['suspended', 'blocked'],
  ['blocked', 'active'],
];

describe('user status machine', () => {
  // Every pair is listed, so adding a status or a move forces this test to be updated.
  const allPairs = USER_STATUSES.flatMap((from) => USER_STATUSES.map((to) => [from, to] as const));

  it.each(allPairs)('%s -> %s', (from, to) => {
    const expected = ALLOWED.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(expected);
  });
});
