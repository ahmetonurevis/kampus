CREATE TABLE "student_identities" (
	"institution_id" text NOT NULL,
	"student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"identity_kind" text NOT NULL,
	"identity_number" text NOT NULL,
	"birth_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_identities_pkey" PRIMARY KEY("institution_id","student_id"),
	CONSTRAINT "student_identities_kind_check" CHECK ("student_identities"."identity_kind" in ('tc', 'foreign'))
);
--> statement-breakpoint
ALTER TABLE "fee_tariffs" ADD COLUMN "discounts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_identities" ADD CONSTRAINT "student_identities_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_identities_number_key" ON "student_identities" USING btree ("institution_id","academic_year","identity_number") WHERE "student_identities"."archived_at" is null;