CREATE TABLE "fee_tariffs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"items" jsonb NOT NULL,
	"announced_date" date,
	"mebbis_recorded_date" date,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fee_tariffs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "fee_tariffs_status_check" CHECK ("fee_tariffs"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "fee_tariffs_published_check" CHECK ("fee_tariffs"."status" = 'draft' or ("fee_tariffs"."announced_date" is not null and "fee_tariffs"."published_by_user_id" is not null and "fee_tariffs"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "fee_tariffs" ADD CONSTRAINT "fee_tariffs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_tariffs_year_version_key" ON "fee_tariffs" USING btree ("institution_id","academic_year","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_tariffs_draft_key" ON "fee_tariffs" USING btree ("institution_id","academic_year") WHERE "fee_tariffs"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_tariffs_published_key" ON "fee_tariffs" USING btree ("institution_id","academic_year") WHERE "fee_tariffs"."status" = 'published';--> statement-breakpoint
CREATE INDEX "fee_tariffs_year_idx" ON "fee_tariffs" USING btree ("institution_id","academic_year");