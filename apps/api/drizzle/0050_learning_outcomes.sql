CREATE TABLE "learning_outcomes" (
	"institution_id" text NOT NULL,
	"code" text NOT NULL,
	"subject_id" text NOT NULL,
	"grade_level" integer NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "learning_outcomes_pkey" PRIMARY KEY("institution_id","code"),
	CONSTRAINT "learning_outcomes_grade_level_check" CHECK ("learning_outcomes"."grade_level" between 5 and 12),
	CONSTRAINT "learning_outcomes_code_check" CHECK (char_length("learning_outcomes"."code") between 1 and 40),
	CONSTRAINT "learning_outcomes_name_check" CHECK (char_length("learning_outcomes"."name") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "platform_learning_outcomes" (
	"code" text NOT NULL,
	"program_version" text NOT NULL,
	"subject_id" text NOT NULL,
	"grade_level" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_learning_outcomes_pkey" PRIMARY KEY("code"),
	CONSTRAINT "platform_learning_outcomes_grade_level_check" CHECK ("platform_learning_outcomes"."grade_level" between 5 and 12),
	CONSTRAINT "platform_learning_outcomes_code_check" CHECK (char_length("platform_learning_outcomes"."code") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_outcomes_subject_grade_idx" ON "learning_outcomes" USING btree ("institution_id","subject_id","grade_level");--> statement-breakpoint
CREATE INDEX "platform_learning_outcomes_subject_grade_idx" ON "platform_learning_outcomes" USING btree ("subject_id","grade_level","position");