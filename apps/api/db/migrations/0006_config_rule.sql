CREATE TABLE "config_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"city_id" uuid,
	"zone_id" uuid,
	"category_id" uuid,
	"subcategory_id" uuid,
	"problem_id" uuid,
	"value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "config_rule_status_check" CHECK ("config_rule"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "config_rule_reason_check" CHECK (length(trim("config_rule"."reason")) > 0),
	CONSTRAINT "config_rule_effective_range_check" CHECK ("config_rule"."effective_to" is null or "config_rule"."effective_to" > "config_rule"."effective_from"),
	CONSTRAINT "config_rule_maker_checker_check" CHECK ("config_rule"."approved_by" is null or "config_rule"."approved_by" <> "config_rule"."created_by"),
	CONSTRAINT "config_rule_one_geo_scope_check" CHECK (num_nonnulls("config_rule"."city_id", "config_rule"."zone_id") <= 1),
	CONSTRAINT "config_rule_one_catalogue_scope_check" CHECK (num_nonnulls("config_rule"."category_id", "config_rule"."subcategory_id", "config_rule"."problem_id") <= 1)
);
--> statement-breakpoint
ALTER TABLE "config_rule" ADD CONSTRAINT "config_rule_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "config_rule_key_idx" ON "config_rule" USING btree ("key") WHERE "config_rule"."status" = 'approved';