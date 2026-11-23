CREATE TABLE "idempotency_keys" (
	"institution_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("institution_id","user_id","key"),
	CONSTRAINT "idempotency_keys_response_status_check" CHECK ("idempotency_keys"."response_status" between 200 and 299),
	CONSTRAINT "idempotency_keys_key_check" CHECK (char_length("idempotency_keys"."key") between 8 and 128)
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");