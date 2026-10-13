-- Launch geography (real reference data, spec §A and Phase 1 note in docs/decisions.md).
-- Fixed UUIDs so every environment references the same Lucknow row.
INSERT INTO "country" ("id", "code", "name", "is_active")
VALUES ('9e7319f6-b01f-4b0e-b1b0-d73ae7259a45', 'IN', 'India', true);
--> statement-breakpoint
INSERT INTO "state" ("id", "country_id", "code", "name", "is_active")
VALUES ('4c4da96b-9b99-4d86-a163-4fd825376716', '9e7319f6-b01f-4b0e-b1b0-d73ae7259a45', 'UP', 'Uttar Pradesh', true);
--> statement-breakpoint
INSERT INTO "city" ("id", "state_id", "slug", "name", "is_active")
VALUES ('d4046302-ed40-4bd0-84a7-7a9c98614777', '4c4da96b-9b99-4d86-a163-4fd825376716', 'lucknow', 'Lucknow', true);
