CREATE TABLE "admin_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"mfa_enrolled_at" timestamp with time zone,
	"last_totp_step" integer,
	"failed_password_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_credential_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_credential" ADD CONSTRAINT "admin_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;