-- Session lifetimes, decision AUTH-1 (docs/decisions.md); 15-minute access token per spec §M.
INSERT INTO "config_rule" ("key", "value", "version", "status", "effective_from", "reason", "created_by")
SELECT v.key, v.value::jsonb, 1, 'approved', now(), 'Launch defaults (decision AUTH-1)',
       '00000000-0000-0000-0000-000000000001'
FROM (VALUES
  ('auth.access_token_ttl_seconds', '900'),
  ('auth.session.idle_days', '30'),
  ('auth.session.max_days', '90')
) AS v(key, value);
