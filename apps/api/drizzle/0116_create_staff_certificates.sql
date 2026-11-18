CREATE TABLE "staff_certificates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"kind" text NOT NULL,
	"certificate_year" integer NOT NULL,
	"certificate_number" integer NOT NULL,
	"institution_name" text NOT NULL,
	"staff_name" text NOT NULL,
	"position" text NOT NULL,
	"identity_number" text,
	"hire_date" date NOT NULL,
	"exit_date" date,
	"addressee" text NOT NULL,
	"wage_rate_type" text,
	"wage_amount_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"issued_by_name" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_certificates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_certificates_kind_check" CHECK ("staff_certificates"."kind" in ('employment', 'service')),
	CONSTRAINT "staff_certificates_number_check" CHECK ("staff_certificates"."certificate_year" between 2000 and 2999 and "staff_certificates"."certificate_number" > 0),
	CONSTRAINT "staff_certificates_position_check" CHECK (char_length("staff_certificates"."position") between 2 and 120),
	CONSTRAINT "staff_certificates_addressee_check" CHECK (char_length("staff_certificates"."addressee") between 1 and 200),
	CONSTRAINT "staff_certificates_identity_number_check" CHECK ("staff_certificates"."identity_number" is null or "staff_certificates"."identity_number" ~ '^[1-9][0-9]{10}$'),
	CONSTRAINT "staff_certificates_dates_check" CHECK ((("staff_certificates"."kind" = 'service') = ("staff_certificates"."exit_date" is not null))
        and ("staff_certificates"."exit_date" is null or "staff_certificates"."exit_date" >= "staff_certificates"."hire_date")),
	CONSTRAINT "staff_certificates_wage_check" CHECK ((("staff_certificates"."wage_rate_type" is null) = ("staff_certificates"."wage_amount_cents" is null))
        and ("staff_certificates"."wage_rate_type" is null or ("staff_certificates"."kind" = 'employment'
          and "staff_certificates"."wage_rate_type" in ('monthly_gross', 'monthly_net', 'hourly', 'lesson_hour') and "staff_certificates"."wage_amount_cents" > 0))),
	CONSTRAINT "staff_certificates_currency_check" CHECK ("staff_certificates"."currency" = 'TRY'),
	CONSTRAINT "staff_certificates_cancel_check" CHECK ((("staff_certificates"."cancelled_at" is null) = ("staff_certificates"."cancelled_by_user_id" is null))
        and (("staff_certificates"."cancelled_at" is null) = ("staff_certificates"."cancel_reason" is null))
        and ("staff_certificates"."cancel_reason" is null or char_length("staff_certificates"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_certificates" ADD CONSTRAINT "staff_certificates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certificates" ADD CONSTRAINT "staff_certificates_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_certificates_number_key" ON "staff_certificates" USING btree ("institution_id","certificate_year","certificate_number");--> statement-breakpoint
CREATE INDEX "staff_certificates_membership_idx" ON "staff_certificates" USING btree ("institution_id","membership_id","created_at");