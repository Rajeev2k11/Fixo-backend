/** True when a database error (as wrapped by Drizzle) is a unique-constraint violation. */
export function uniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}

/** "Gomti Nagar" -> "gomti-nagar": a stable, URL-safe key derived from a display name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
