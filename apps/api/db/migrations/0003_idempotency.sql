CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_key_scope_key_unique" UNIQUE("scope","key"),
	CONSTRAINT "idempotency_key_status_check" CHECK ("idempotency_key"."status" in ('in_progress', 'completed'))
);
