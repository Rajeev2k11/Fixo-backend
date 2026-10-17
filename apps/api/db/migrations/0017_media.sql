CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_type" text NOT NULL,
	"declared_bytes" integer NOT NULL,
	"size_bytes" integer,
	"object_key" text NOT NULL,
	"reject_reason" text,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "media_objectKey_unique" UNIQUE("object_key"),
	CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('profile_photo', 'kyc_selfie')),
	CONSTRAINT "media_status_check" CHECK ("media"."status" in ('pending', 'ready', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_user_id");