CREATE TABLE "service_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_city_id_slug_unique" UNIQUE("city_id","slug")
);
--> statement-breakpoint
CREATE TABLE "worker_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_area_user_id_area_id_unique" UNIQUE("user_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "worker_kyc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"aadhaar_front_media_id" uuid NOT NULL,
	"aadhaar_back_media_id" uuid NOT NULL,
	"selfie_media_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_kyc_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "worker_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"whole_city" boolean NOT NULL,
	"days" text[] NOT NULL,
	"all_day" boolean NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"emergency" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_preference_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "worker_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"skill_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_service_user_id_category_id_unique" UNIQUE("user_id","category_id"),
	CONSTRAINT "worker_service_skill_status_check" CHECK ("worker_service"."skill_status" in ('pending', 'probation', 'verified', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_purpose_check";--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "experience_years" integer;--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_area" ADD CONSTRAINT "worker_area_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_area" ADD CONSTRAINT "worker_area_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_area" ADD CONSTRAINT "worker_area_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_kyc" ADD CONSTRAINT "worker_kyc_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_kyc" ADD CONSTRAINT "worker_kyc_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_preference" ADD CONSTRAINT "worker_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_preference" ADD CONSTRAINT "worker_preference_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_service" ADD CONSTRAINT "worker_service_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_service" ADD CONSTRAINT "worker_service_category_id_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_service" ADD CONSTRAINT "worker_service_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('profile_photo', 'kyc_selfie', 'aadhaar_front', 'aadhaar_back'));