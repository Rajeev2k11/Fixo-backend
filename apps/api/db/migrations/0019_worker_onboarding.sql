CREATE TABLE "worker_agreement_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_agreement_acceptance_user_version_unique" UNIQUE("user_id","version")
);
--> statement-breakpoint
CREATE TABLE "worker_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "status" text DEFAULT 'registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_profile" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "worker_agreement_acceptance" ADD CONSTRAINT "worker_agreement_acceptance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_history" ADD CONSTRAINT "worker_status_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_history" ADD CONSTRAINT "worker_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_profile_review_idx" ON "worker_profile" USING btree ("status","updated_at") WHERE "worker_profile"."status" in ('kyc_pending', 'under_review');--> statement-breakpoint
ALTER TABLE "worker_profile" ADD CONSTRAINT "worker_profile_status_check" CHECK ("worker_profile"."status" in ('registered', 'kyc_pending', 'under_review', 'verified', 'rejected', 'suspended'));