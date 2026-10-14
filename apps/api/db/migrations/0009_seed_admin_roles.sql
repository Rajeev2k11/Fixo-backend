-- The five admin roles from spec §D and §Y. `code` is the stable identifier used in code.
INSERT INTO "admin_role" ("code", "name") VALUES
  ('super_admin', 'Super admin'),
  ('operations', 'Operations'),
  ('verification', 'Verification'),
  ('finance', 'Finance'),
  ('support', 'Support');
