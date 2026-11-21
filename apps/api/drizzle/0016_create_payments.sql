CREATE TABLE "payment_allocations" (
	"institution_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_allocations_pkey" PRIMARY KEY("institution_id","payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_cents_check" CHECK ("payment_allocations"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"cash_payments_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone NOT NULL,
	"receipt_year" integer NOT NULL,
	"receipt_number" integer NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_user_id" text,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payments_amount_cents_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" = 'TRY'),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('bank_transfer', 'cash', 'card')),
	CONSTRAINT "payments_reversal_check" CHECK (("payments"."reversed_at" is null and "payments"."reversed_by_user_id" is null and "payments"."reversal_reason" is null) or ("payments"."reversed_at" is not null and "payments"."reversed_by_user_id" is not null and "payments"."reversal_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fkey" FOREIGN KEY ("institution_id","payment_id") REFERENCES "public"."payments"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_key" ON "payments" USING btree ("institution_id","reference") WHERE "payments"."reference" is not null and "payments"."reversed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_key" ON "payments" USING btree ("institution_id","receipt_year","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_student_paid_at_idx" ON "payments" USING btree ("institution_id","student_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("institution_id","paid_at");