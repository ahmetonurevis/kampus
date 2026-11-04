CREATE TABLE "task_extra_times" (
	"institution_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_extra_times_pkey" PRIMARY KEY("institution_id","assignment_id","learner_id","sequence"),
	CONSTRAINT "task_extra_times_sequence_check" CHECK ("task_extra_times"."sequence" >= 1),
	CONSTRAINT "task_extra_times_minutes_check" CHECK ("task_extra_times"."minutes" between 0 and 300),
	CONSTRAINT "task_extra_times_reason_check" CHECK ("task_extra_times"."reason" in ('accommodation', 'technical_issue', 'other')),
	CONSTRAINT "task_extra_times_removal_check" CHECK (("task_extra_times"."minutes" = 0) = ("task_extra_times"."reason" is null)),
	CONSTRAINT "task_extra_times_version_check" CHECK ("task_extra_times"."version" = 1 and "task_extra_times"."archived_at" is null)
);
--> statement-breakpoint
ALTER TABLE "task_extra_times" ADD CONSTRAINT "task_extra_times_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_extra_times" ADD CONSTRAINT "task_extra_times_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "task_extra_times_immutable_trigger" BEFORE UPDATE OR DELETE ON "task_extra_times" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "task_extra_times_truncate_trigger" BEFORE TRUNCATE ON "task_extra_times" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
