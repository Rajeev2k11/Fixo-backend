-- Constraints drizzle's schema builder cannot express (they need expressions).
-- Null scope columns mean "any", so they are coalesced to a sentinel to compare as equal.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- At any instant, a key in a given scope has at most one approved value.
ALTER TABLE "config_rule" ADD CONSTRAINT "config_rule_no_overlap" EXCLUDE USING gist (
  "key" WITH =,
  (coalesce("city_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  (coalesce("zone_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  (coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  (coalesce("subcategory_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  (coalesce("problem_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  tstzrange("effective_from", "effective_to") WITH &&
) WHERE ("status" = 'approved');
--> statement-breakpoint
CREATE UNIQUE INDEX "config_rule_version_unique" ON "config_rule" (
  "key",
  (coalesce("city_id", '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce("zone_id", '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce("subcategory_id", '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce("problem_id", '00000000-0000-0000-0000-000000000000'::uuid)),
  "version"
);
