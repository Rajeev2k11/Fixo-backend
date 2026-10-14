-- The "system" actor for values shipped in migrations (config_rule.created_by must be a real user).
-- It has no auth identity, so nobody can log in as it, and it is blocked as a second safeguard.
INSERT INTO "user" ("id", "status") VALUES ('00000000-0000-0000-0000-000000000001', 'blocked');
--> statement-breakpoint
-- OTP security values, decision OTP-1 (docs/decisions.md). Admins change them through config.
INSERT INTO "config_rule" ("key", "value", "version", "status", "effective_from", "reason", "created_by")
SELECT v.key, v.value::jsonb, 1, 'approved', now(), 'Launch defaults (decision OTP-1)',
       '00000000-0000-0000-0000-000000000001'
FROM (VALUES
  ('auth.otp.length', '6'),
  ('auth.otp.ttl_seconds', '300'),
  ('auth.otp.max_attempts', '5'),
  ('auth.otp.limit_per_phone', '{"max": 3, "windowSeconds": 600}'),
  ('auth.otp.limit_per_ip', '{"max": 30, "windowSeconds": 600}'),
  ('auth.otp.limit_per_device', '{"max": 5, "windowSeconds": 600}'),
  ('auth.otp.resend_cooldown_seconds', '30')
) AS v(key, value);
