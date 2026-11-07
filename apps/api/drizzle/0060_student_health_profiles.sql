CREATE TABLE "student_health_profiles" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"key_version" integer NOT NULL,
	"legal_basis" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_health_profiles_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "student_health_profiles_legal_basis_check" CHECK ("student_health_profiles"."legal_basis" in ('explicit_consent', 'vital_interest', 'legal_obligation')),
	CONSTRAINT "student_health_profiles_key_version_check" CHECK ("student_health_profiles"."key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "student_health_profiles" ADD CONSTRAINT "student_health_profiles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_health_profiles_student_key" ON "student_health_profiles" USING btree ("institution_id","student_id") WHERE "student_health_profiles"."archived_at" is null;