/** Scope columns of a rule; undefined/null means "any". */
export interface Scope {
  cityId?: string | null | undefined;
  zoneId?: string | null | undefined;
  categoryId?: string | null | undefined;
  subcategoryId?: string | null | undefined;
  problemId?: string | null | undefined;
}

const CATALOGUE_LEVEL = (s: Scope): number =>
  s.problemId ? 3 : s.subcategoryId ? 2 : s.categoryId ? 1 : 0;
const GEO_LEVEL = (s: Scope): number => (s.zoneId ? 2 : s.cityId ? 1 : 0);

/**
 * SPEC-1 precedence: catalogue specificity first (problem > subcategory > category > any),
 * then geography (zone > city > global). Higher sorts first.
 */
export function compareSpecificity(a: Scope, b: Scope): number {
  return CATALOGUE_LEVEL(b) - CATALOGUE_LEVEL(a) || GEO_LEVEL(b) - GEO_LEVEL(a);
}

export function mostSpecific<T extends Scope>(candidates: T[]): T | undefined {
  return candidates.toSorted(compareSpecificity)[0];
}

/** A rule scope may name at most one geography level and one catalogue level. */
export function isValidRuleScope(s: Scope): boolean {
  const set = (...v: (string | null | undefined)[]) => v.filter(Boolean).length;
  return set(s.cityId, s.zoneId) <= 1 && set(s.categoryId, s.subcategoryId, s.problemId) <= 1;
}
