-- Admin login limits, decision AUTH-2 (docs/decisions.md).
INSERT INTO "config_rule" ("key", "value", "version", "status", "effective_from", "reason", "created_by")
SELECT v.key, v.value::jsonb, 1, 'approved', now(), 'Launch defaults (decision AUTH-2)',
       '00000000-0000-0000-0000-000000000001'
FROM (VALUES
  ('auth.admin.session_idle_minutes', '30'),
  ('auth.admin.session_max_hours', '12'),
  ('auth.admin.password_min_length', '12'),
  ('auth.admin.max_password_failures', '5'),
  ('auth.admin.lockout_minutes', '15'),
  ('auth.admin.mfa_max_attempts', '5')
) AS v(key, value);
