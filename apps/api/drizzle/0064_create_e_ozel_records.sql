CREATE TABLE "e_ozel_records" (
	"institution_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"recorded_at" timestamp with time zone,
	"recorded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "e_ozel_records_pkey" PRIMARY KEY("institution_id","kind","source_id"),
	CONSTRAINT "e_ozel_records_kind_check" CHECK ("e_ozel_records"."kind" in ('learner', 'attendance', 'course_end')),
	CONSTRAINT "e_ozel_records_mark_check" CHECK (("e_ozel_records"."recorded_at" is null) = ("e_ozel_records"."recorded_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "e_ozel_records" ADD CONSTRAINT "e_ozel_records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;