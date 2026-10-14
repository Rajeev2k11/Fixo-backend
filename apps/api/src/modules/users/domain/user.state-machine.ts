// Pure: no framework imports (CLAUDE.md folder layout).

export const USER_STATUSES = ['active', 'suspended', 'blocked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Account status moves. Restoring a blocked account is an explicit admin action (spec §Y). */
const ALLOWED: Record<UserStatus, readonly UserStatus[]> = {
  active: ['suspended', 'blocked'],
  suspended: ['active', 'blocked'],
  blocked: ['active'],
};

export function canTransition(from: UserStatus, to: UserStatus): boolean {
  return ALLOWED[from].includes(to);
}
