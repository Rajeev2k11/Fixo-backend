-- Largest upload: 5 MB (agreed in the Phase 2 plan, 2026-10-17). Admins change it through config.
INSERT INTO "config_rule" ("key", "value", "version", "status", "effective_from", "reason", "created_by")
VALUES ('media.max_upload_bytes', '5242880'::jsonb, 1, 'approved', now(),
        'Launch default (Phase 2 plan)', '00000000-0000-0000-0000-000000000001');
