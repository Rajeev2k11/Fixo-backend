import { describe, expect, it } from 'vitest';

import { isValidRuleScope, mostSpecific, type Scope } from './config.rules.js';

const named = (name: string, scope: Scope) => ({ name, ...scope });

describe('mostSpecific (SPEC-1: catalogue first, then geography)', () => {
  const rules = [
    named('global', {}),
    named('city', { cityId: 'c' }),
    named('zone', { zoneId: 'z' }),
    named('category', { categoryId: 'cat' }),
    named('category+zone', { categoryId: 'cat', zoneId: 'z' }),
    named('subcategory', { subcategoryId: 'sub' }),
    named('problem', { problemId: 'p' }),
    named('problem+city', { problemId: 'p', cityId: 'c' }),
  ];

  it.each([
    [['global', 'city'], 'city'],
    [['city', 'zone'], 'zone'],
    // any catalogue level beats any geography level
    [['zone', 'category'], 'category'],
    [['category+zone', 'subcategory'], 'subcategory'],
    [['subcategory', 'problem'], 'problem'],
    // same catalogue level: geography breaks the tie
    [['category', 'category+zone'], 'category+zone'],
    [['problem', 'problem+city'], 'problem+city'],
    [rules.map((r) => r.name), 'problem+city'],
  ])('%j -> %s', (names, winner) => {
    const candidates = rules.filter((r) => names.includes(r.name));
    expect(mostSpecific(candidates)?.name).toBe(winner);
  });

  it('returns undefined when nothing matches', () => {
    expect(mostSpecific<Scope>([])).toBeUndefined();
  });
});

describe('isValidRuleScope', () => {
  it('allows one geography and one catalogue level', () => {
    expect(isValidRuleScope({ cityId: 'c', problemId: 'p' })).toBe(true);
  });

  it('rejects two levels of the same dimension', () => {
    expect(isValidRuleScope({ cityId: 'c', zoneId: 'z' })).toBe(false);
    expect(isValidRuleScope({ categoryId: 'a', problemId: 'p' })).toBe(false);
  });
});
