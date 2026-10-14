import type { Pool } from 'pg';

/** A bare user row, for tests that need a real actor (audit and config actors are foreign keys). */
export async function createUser(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into "user" default values returning id',
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('user insert returned no row');
  return id;
}
