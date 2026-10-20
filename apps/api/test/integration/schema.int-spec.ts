import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

async function rows<T>(text: string): Promise<T[]> {
  return (await pool.query(text)).rows as T[];
}

// Tables we own: public schema, excluding tables created by extensions (e.g. PostGIS's spatial_ref_sys).
const OUR_TABLES = `
  select c.relname as table_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')`;

// Tables that are not "operational rows" and so carry no city_id (CLAUDE.md rule 9).
// Adding a table here should be a deliberate, reviewed decision.
const NO_CITY_ID = [
  // geography reference data
  'country',
  'state',
  'city',
  // platform infrastructure (events may span cities; the payload carries city_id when relevant)
  'outbox_event',
  'processed_event',
  'idempotency_key',
  'audit_log',
  // identity and access control: not city-scoped (a user's home city is user.city_id)
  'auth_identity',
  'customer_profile',
  'worker_profile',
  'admin_profile',
  'admin_role',
  'user_admin_role',
  'user_status_history',
  'worker_status_history',
  'worker_agreement_acceptance',
  'otp_challenge',
  'session',
  'refresh_token',
  'admin_credential',
  // belongs to a user; its city is the owner's
  'media',
  // catalogue reference data: not city-specific
  'service_category',
];

describe('schema conventions (CLAUDE.md rule 9)', () => {
  it('every table has a uuid primary key named id', async () => {
    const offenders = await rows<{ table: string }>(`
      select t.table_name as table
      from (${OUR_TABLES}) t
      where not exists (
        select 1
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = format('public.%I', t.table_name)::regclass
          and i.indisprimary and i.indnatts = 1
          and a.attname = 'id' and a.atttypid = 'uuid'::regtype
      )`);

    expect(offenders).toEqual([]);
  });

  it('no column uses timestamp without time zone', async () => {
    const offenders = await rows<{ column: string }>(`
      select table_name || '.' || column_name as column
      from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp without time zone'
        and table_name in (select table_name from (${OUR_TABLES}) t)`);

    expect(offenders).toEqual([]);
  });

  it('every operational table has city_id', async () => {
    const offenders = await rows<{ table: string }>(`
      select t.table_name as table
      from (${OUR_TABLES}) t
      where t.table_name <> all (array[${NO_CITY_ID.map((n) => `'${n}'`).join(',')}])
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'city_id'
        )`);

    expect(offenders).toEqual([]);
  });
});

describe('launch geography seed', () => {
  it('has Lucknow, active, under Uttar Pradesh, India', async () => {
    const [lucknow] = await rows<Record<string, unknown>>(`
      select ci.id, ci.is_active, s.code as state, co.code as country
      from city ci join state s on s.id = ci.state_id join country co on co.id = s.country_id
      where ci.slug = 'lucknow'`);

    expect(lucknow).toEqual({
      id: 'd4046302-ed40-4bd0-84a7-7a9c98614777',
      is_active: true,
      state: 'UP',
      country: 'IN',
    });
  });
});
