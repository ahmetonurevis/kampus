CREATE TABLE "institution_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"academic_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "institution_settings_academic_year_check" CHECK ("institution_settings"."academic_year" between 2000 and 2100)
);
--> statement-breakpoint
ALTER TABLE "institution_settings" ADD CONSTRAINT "institution_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;