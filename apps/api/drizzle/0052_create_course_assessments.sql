CREATE TABLE "course_assessments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"point" text NOT NULL,
	"score" double precision NOT NULL,
	"skills" jsonb NOT NULL,
	"assessed_by_user_id" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "course_assessments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "course_assessments_point_check" CHECK ("course_assessments"."point" in ('baseline', 'midterm', 'final')),
	CONSTRAINT "course_assessments_score_check" CHECK ("course_assessments"."score" >= 0 and "course_assessments"."score" <= 100),
	CONSTRAINT "course_assessments_skills_check" CHECK (jsonb_typeof("course_assessments"."skills") = 'array' and jsonb_array_length("course_assessments"."skills") = 4),
	CONSTRAINT "course_assessments_version_check" CHECK ("course_assessments"."version" = 1 and "course_assessments"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "lesson_hour_attendances" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"lesson_hour_id" text NOT NULL,
	"status" text NOT NULL,
	"excused" boolean DEFAULT false NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_hour_attendances_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_hour_attendances_status_check" CHECK ("lesson_hour_attendances"."status" in ('present', 'late', 'absent')),
	CONSTRAINT "lesson_hour_attendances_lesson_hour_check" CHECK (char_length("lesson_hour_attendances"."lesson_hour_id") between 1 and 200),
	CONSTRAINT "lesson_hour_attendances_excused_check" CHECK (not "lesson_hour_attendances"."excused" or "lesson_hour_attendances"."status" = 'absent')
);
--> statement-breakpoint
ALTER TABLE "course_assessments" ADD CONSTRAINT "course_assessments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assessments" ADD CONSTRAINT "course_assessments_enrollment_fkey" FOREIGN KEY ("institution_id","enrollment_id","group_id","learner_id") REFERENCES "public"."language_group_members"("institution_id","id","group_id","student_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assessments" ADD CONSTRAINT "course_assessments_assessed_by_fkey" FOREIGN KEY ("institution_id","assessed_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_attendances" ADD CONSTRAINT "lesson_hour_attendances_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_attendances" ADD CONSTRAINT "lesson_hour_attendances_enrollment_fkey" FOREIGN KEY ("institution_id","enrollment_id","group_id","learner_id") REFERENCES "public"."language_group_members"("institution_id","id","group_id","student_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_hour_attendances" ADD CONSTRAINT "lesson_hour_attendances_recorded_by_fkey" FOREIGN KEY ("institution_id","recorded_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_assessments_enrollment_point_key" ON "course_assessments" USING btree ("institution_id","enrollment_id","point") WHERE "course_assessments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "course_assessments_group_idx" ON "course_assessments" USING btree ("institution_id","group_id");--> statement-breakpoint
CREATE INDEX "course_assessments_learner_idx" ON "course_assessments" USING btree ("institution_id","learner_id");--> statement-breakpoint
CREATE INDEX "course_assessments_assessed_by_idx" ON "course_assessments" USING btree ("institution_id","assessed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_hour_attendances_enrollment_hour_key" ON "lesson_hour_attendances" USING btree ("institution_id","enrollment_id","lesson_hour_id") WHERE "lesson_hour_attendances"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "lesson_hour_attendances_group_idx" ON "lesson_hour_attendances" USING btree ("institution_id","group_id");--> statement-breakpoint
CREATE INDEX "lesson_hour_attendances_learner_idx" ON "lesson_hour_attendances" USING btree ("institution_id","learner_id");--> statement-breakpoint
CREATE INDEX "lesson_hour_attendances_recorded_by_idx" ON "lesson_hour_attendances" USING btree ("institution_id","recorded_by_user_id");--> statement-breakpoint
-- Elle yazıldı: kur içi ölçme puanı değişmez satırdır (veritabani.md, DOM-DIL-013); nokta kayıt
-- başına bir kez girilir, düzeltme modeli yok (`TODO(cefr-olcme-duzeltme)`). Ortak
-- `kampus_reject_immutable_change()` (migration 0013) her `update`/`delete`/`truncate`'i 55000 ile
-- reddeder; yalnız imha işi `set local kampus.allow_immutable_purge = 'on'` ile `delete` yapar.
CREATE TRIGGER "course_assessments_immutable_trigger" BEFORE UPDATE OR DELETE ON "course_assessments" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "course_assessments_truncate_trigger" BEFORE TRUNCATE ON "course_assessments" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
