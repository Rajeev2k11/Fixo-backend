// Pure: who may change which config keys (spec §Y modules 9-11, decision SPEC-2).

interface Policy {
  propose: readonly string[];
  /** Only used by keys that require approval (defineConfigKey requiresApproval). */
  approve: readonly string[];
}

const BY_PREFIX: readonly (Policy & { prefix: string })[] = [
  // Spec §Y: revenue rules are changed by super admin and approved by finance.
  { prefix: 'revenue.', propose: ['super_admin'], approve: ['finance'] },
  // Security settings (OTP, sessions, admin login): super admin only.
  { prefix: 'auth.', propose: ['super_admin'], approve: ['super_admin'] },
];
// Spec §Y: pricing rules and marketplace settings are operations or super admin.
const DEFAULT: Policy = { propose: ['super_admin', 'operations'], approve: ['finance'] };

export function configPolicy(key: string): Policy {
  const { propose, approve } = BY_PREFIX.find((p) => key.startsWith(p.prefix)) ?? DEFAULT;
  return { propose, approve };
}

/** Actor.role holds the admin's role codes, comma-separated (an admin may hold several). */
export function holdsAnyRole(actorRole: string, allowed: readonly string[]): boolean {
  return actorRole.split(',').some((role) => allowed.includes(role));
}
