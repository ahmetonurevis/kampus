-- Beceri görevi tabloları (ADR 0004 karar 4–7 ve F4b1 eki): rubrik ve sürümü, atama ve hedefleri,
-- deneme, teslim, değişmez teslim sürümü, taslak, yeniden teslim isteği, rubrik puanı, ikinci
-- puanlama isteği, itiraz ve not aktarımı. Tablolar yeni ve boştur: `not valid` adımı gerekmez.
-- Değişmez tablolar (teslim sürümü, rubrik puanı, yeniden teslim isteği, not aktarımı) dosyanın
-- sonundaki elle yazılmış tetikleyiciyle korunur; `<tablo>_version_check` yalnız eklemeyi sınırlar.
-- TODO(F3c2-files): attempt_media_plays ve teslim sürümünün dosya bağlantıları `files` ile gelir.
CREATE TABLE "resubmission_requests" (
	"institution_id" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resubmission_requests_pkey" PRIMARY KEY("institution_id","submission_id","version_number"),
	CONSTRAINT "resubmission_requests_due_check" CHECK ("resubmission_requests"."due_at" > "resubmission_requests"."requested_at"),
	CONSTRAINT "resubmission_requests_version_check" CHECK ("resubmission_requests"."version" = 1 and "resubmission_requests"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "rubric_scores" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"submission_version_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"rater_user_id" text NOT NULL,
	"rater_role" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"overall_comment" text NOT NULL,
	"scored_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rubric_scores_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "rubric_scores_rater_role_check" CHECK ("rubric_scores"."rater_role" in ('first', 'second', 'final')),
	CONSTRAINT "rubric_scores_criteria_check" CHECK (jsonb_typeof("rubric_scores"."criteria") = 'array' and jsonb_array_length("rubric_scores"."criteria") between 1 and 10),
	CONSTRAINT "rubric_scores_overall_comment_check" CHECK (char_length("rubric_scores"."overall_comment") <= 5000),
	CONSTRAINT "rubric_scores_version_check" CHECK ("rubric_scores"."version" = 1 and "rubric_scores"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"skill" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rubric_versions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "rubric_versions_status_check" CHECK ("rubric_versions"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "rubric_versions_kind_check" CHECK ("rubric_versions"."kind" in ('analytic', 'holistic')),
	CONSTRAINT "rubric_versions_skill_check" CHECK ("rubric_versions"."skill" in ('writing', 'speaking', 'mediation')),
	CONSTRAINT "rubric_versions_number_check" CHECK ("rubric_versions"."version_number" >= 1),
	CONSTRAINT "rubric_versions_title_check" CHECK (char_length("rubric_versions"."title") <= 200),
	CONSTRAINT "rubric_versions_criteria_check" CHECK (jsonb_typeof("rubric_versions"."criteria") = 'array' and jsonb_array_length("rubric_versions"."criteria") between 1 and 10),
	CONSTRAINT "rubric_versions_published_check" CHECK (("rubric_versions"."status" = 'draft') = ("rubric_versions"."published_at" is null)
        and ("rubric_versions"."status" <> 'published' or "rubric_versions"."archived_at" is null)
        and ("rubric_versions"."status" <> 'archived' or "rubric_versions"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rubrics_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
CREATE TABLE "score_appeals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"submission_version_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"filed_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"outcome" text,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "score_appeals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "score_appeals_outcome_check" CHECK ("score_appeals"."outcome" is null or "score_appeals"."outcome" in ('upheld', 'rejected')),
	CONSTRAINT "score_appeals_decision_check" CHECK (("score_appeals"."outcome" is null) = ("score_appeals"."decided_at" is null)
        and ("score_appeals"."outcome" is null) = ("score_appeals"."decided_by_user_id" is null)
        and ("score_appeals"."outcome" is null) = ("score_appeals"."decision_reason" is null)
        and ("score_appeals"."decided_at" is null or "score_appeals"."decided_at" >= "score_appeals"."filed_at")),
	CONSTRAINT "score_appeals_reason_check" CHECK (char_length("score_appeals"."reason") <= 2000),
	CONSTRAINT "score_appeals_decision_reason_check" CHECK ("score_appeals"."decision_reason" is null or char_length("score_appeals"."decision_reason") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "score_transfers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"grade_type" text NOT NULL,
	"score" integer NOT NULL,
	"source_attempt_id" uuid,
	"source_rubric_score_id" uuid,
	"grade_record_id" text NOT NULL,
	"transferred_by_user_id" text NOT NULL,
	"transferred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "score_transfers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "score_transfers_grade_type_check" CHECK ("score_transfers"."grade_type" in ('sinav', 'performans', 'proje')),
	CONSTRAINT "score_transfers_score_check" CHECK ("score_transfers"."score" between 0 and 100),
	CONSTRAINT "score_transfers_source_check" CHECK (("score_transfers"."source_attempt_id" is null) <> ("score_transfers"."source_rubric_score_id" is null)),
	CONSTRAINT "score_transfers_version_check" CHECK ("score_transfers"."version" = 1 and "score_transfers"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "second_rating_requests" (
	"institution_id" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"source" text NOT NULL,
	"requested_by_user_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "second_rating_requests_pkey" PRIMARY KEY("institution_id","submission_id"),
	CONSTRAINT "second_rating_requests_source_check" CHECK ("second_rating_requests"."source" in ('sample', 'manual')),
	CONSTRAINT "second_rating_requests_requester_check" CHECK (("second_rating_requests"."source" = 'manual') = ("second_rating_requests"."requested_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "submission_drafts" (
	"institution_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "submission_drafts_pkey" PRIMARY KEY("institution_id","assignment_id","learner_id"),
	CONSTRAINT "submission_drafts_body_check" CHECK (char_length("submission_drafts"."body") <= 50000)
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "submission_versions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "submission_versions_submission_number_key" UNIQUE("institution_id","submission_id","version_number"),
	CONSTRAINT "submission_versions_number_check" CHECK ("submission_versions"."version_number" >= 1),
	CONSTRAINT "submission_versions_body_check" CHECK ("submission_versions"."body" is null or char_length("submission_versions"."body") <= 50000),
	CONSTRAINT "submission_versions_version_check" CHECK ("submission_versions"."version" = 1 and "submission_versions"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "task_assignment_targets" (
	"institution_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_assignment_targets_pkey" PRIMARY KEY("institution_id","assignment_id","target_kind","target_id"),
	CONSTRAINT "task_assignment_targets_kind_check" CHECK ("task_assignment_targets"."target_kind" in ('class', 'group', 'student'))
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"scoring_version_id" uuid NOT NULL,
	"rubric_version_id" uuid,
	"scoring_mode" text NOT NULL,
	"kind" text NOT NULL,
	"max_attempts" integer,
	"count_policy" text,
	"due_at" timestamp with time zone,
	"late_acceptance_days" integer DEFAULT 0 NOT NULL,
	"time_limit_minutes" integer,
	"listening_plays" integer,
	"show_transcript" boolean DEFAULT false NOT NULL,
	"submission_settings" jsonb,
	"submission_kind" text GENERATED ALWAYS AS ((submission_settings ->> 'submissionKind')) STORED,
	"high_stakes" boolean DEFAULT false NOT NULL,
	"second_rating_percent" integer DEFAULT 0 NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_assignments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "task_assignments_kind_check" CHECK ("task_assignments"."kind" in ('evaluation', 'practice')),
	CONSTRAINT "task_assignments_scoring_mode_check" CHECK ("task_assignments"."scoring_mode" in ('auto', 'teacher')),
	CONSTRAINT "task_assignments_attempts_check" CHECK (("task_assignments"."kind" = 'practice') = ("task_assignments"."max_attempts" is null)
        and ("task_assignments"."max_attempts" is null) = ("task_assignments"."count_policy" is null)
        and ("task_assignments"."max_attempts" is null or "task_assignments"."max_attempts" between 1 and 3)
        and ("task_assignments"."count_policy" is null or "task_assignments"."count_policy" in ('first', 'highest'))
        and ("task_assignments"."count_policy" is distinct from 'highest' or "task_assignments"."max_attempts" > 1)
        and ("task_assignments"."scoring_mode" = 'auto' or "task_assignments"."max_attempts" is null
          or ("task_assignments"."max_attempts" = 1 and "task_assignments"."count_policy" = 'first'))),
	CONSTRAINT "task_assignments_deadline_check" CHECK (("task_assignments"."kind" = 'practice' or "task_assignments"."due_at" is not null)
        and "task_assignments"."late_acceptance_days" between 0 and 7),
	CONSTRAINT "task_assignments_time_limit_check" CHECK ("task_assignments"."time_limit_minutes" is null or "task_assignments"."time_limit_minutes" between 1 and 300),
	CONSTRAINT "task_assignments_listening_plays_check" CHECK ("task_assignments"."listening_plays" is null or "task_assignments"."listening_plays" in (1, 2)),
	CONSTRAINT "task_assignments_transcript_check" CHECK (not ("task_assignments"."kind" = 'evaluation' and "task_assignments"."show_transcript")),
	CONSTRAINT "task_assignments_second_rating_check" CHECK ("task_assignments"."second_rating_percent" between 0 and 100
        and ("task_assignments"."scoring_mode" = 'teacher' or "task_assignments"."second_rating_percent" = 0)
        and not ("task_assignments"."kind" = 'practice' and "task_assignments"."high_stakes")
        and (not "task_assignments"."high_stakes" or "task_assignments"."scoring_mode" = 'auto' or "task_assignments"."second_rating_percent" >= 10)),
	CONSTRAINT "task_assignments_mode_check" CHECK (("task_assignments"."scoring_mode" = 'teacher') = ("task_assignments"."submission_settings" is not null)
        and ("task_assignments"."scoring_mode" = 'teacher' or "task_assignments"."rubric_version_id" is null)
        and ("task_assignments"."scoring_mode" = 'auto'
          or ("task_assignments"."time_limit_minutes" is null and "task_assignments"."listening_plays" is null))),
	CONSTRAINT "task_assignments_submission_kind_check" CHECK ("task_assignments"."submission_kind" is null or "task_assignments"."submission_kind" in ('text', 'file', 'audio'))
);
--> statement-breakpoint
CREATE TABLE "task_attempts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_attempts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "task_attempts_id_assignment_learner_key" UNIQUE("institution_id","id","assignment_id","learner_id"),
	CONSTRAINT "task_attempts_number_check" CHECK ("task_attempts"."attempt_number" >= 1),
	CONSTRAINT "task_attempts_submitted_check" CHECK ("task_attempts"."submitted_at" is null or "task_attempts"."submitted_at" >= "task_attempts"."started_at"),
	CONSTRAINT "task_attempts_answers_check" CHECK (jsonb_typeof("task_attempts"."answers") = 'object')
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_submissions_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
ALTER TABLE "resubmission_requests" ADD CONSTRAINT "resubmission_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resubmission_requests" ADD CONSTRAINT "resubmission_requests_version_fkey" FOREIGN KEY ("institution_id","submission_id","version_number") REFERENCES "public"."submission_versions"("institution_id","submission_id","version_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_scores" ADD CONSTRAINT "rubric_scores_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_scores" ADD CONSTRAINT "rubric_scores_submission_version_fkey" FOREIGN KEY ("institution_id","submission_version_id") REFERENCES "public"."submission_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_scores" ADD CONSTRAINT "rubric_scores_rubric_version_fkey" FOREIGN KEY ("institution_id","rubric_version_id") REFERENCES "public"."rubric_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_rubric_fkey" FOREIGN KEY ("institution_id","rubric_id") REFERENCES "public"."rubrics"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_appeals" ADD CONSTRAINT "score_appeals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_appeals" ADD CONSTRAINT "score_appeals_submission_version_fkey" FOREIGN KEY ("institution_id","submission_version_id") REFERENCES "public"."submission_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transfers" ADD CONSTRAINT "score_transfers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transfers" ADD CONSTRAINT "score_transfers_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transfers" ADD CONSTRAINT "score_transfers_source_attempt_fkey" FOREIGN KEY ("institution_id","source_attempt_id","assignment_id","learner_id") REFERENCES "public"."task_attempts"("institution_id","id","assignment_id","learner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_transfers" ADD CONSTRAINT "score_transfers_source_rubric_score_fkey" FOREIGN KEY ("institution_id","source_rubric_score_id") REFERENCES "public"."rubric_scores"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_rating_requests" ADD CONSTRAINT "second_rating_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_rating_requests" ADD CONSTRAINT "second_rating_requests_submission_fkey" FOREIGN KEY ("institution_id","submission_id") REFERENCES "public"."task_submissions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_drafts" ADD CONSTRAINT "submission_drafts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_drafts" ADD CONSTRAINT "submission_drafts_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_fkey" FOREIGN KEY ("institution_id","submission_id") REFERENCES "public"."task_submissions"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment_targets" ADD CONSTRAINT "task_assignment_targets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment_targets" ADD CONSTRAINT "task_assignment_targets_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_resource_fkey" FOREIGN KEY ("institution_id","resource_id") REFERENCES "public"."resources"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_resource_version_fkey" FOREIGN KEY ("institution_id","resource_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_scoring_version_fkey" FOREIGN KEY ("institution_id","scoring_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_rubric_version_fkey" FOREIGN KEY ("institution_id","rubric_version_id") REFERENCES "public"."rubric_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_assignment_fkey" FOREIGN KEY ("institution_id","assignment_id") REFERENCES "public"."task_assignments"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rubric_scores_submission_version_idx" ON "rubric_scores" USING btree ("institution_id","submission_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_scores_version_role_key" ON "rubric_scores" USING btree ("institution_id","submission_version_id","rater_role") WHERE "rubric_scores"."rater_role" in ('first', 'second');--> statement-breakpoint
CREATE INDEX "rubric_scores_rubric_version_idx" ON "rubric_scores" USING btree ("institution_id","rubric_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_rubric_number_key" ON "rubric_versions" USING btree ("institution_id","rubric_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_draft_key" ON "rubric_versions" USING btree ("institution_id","rubric_id") WHERE "rubric_versions"."status" = 'draft' and "rubric_versions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_published_key" ON "rubric_versions" USING btree ("institution_id","rubric_id") WHERE "rubric_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "rubrics_owner_idx" ON "rubrics" USING btree ("institution_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_appeals_submission_version_key" ON "score_appeals" USING btree ("institution_id","submission_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_transfers_assignment_learner_key" ON "score_transfers" USING btree ("institution_id","assignment_id","learner_id");--> statement-breakpoint
CREATE INDEX "score_transfers_source_attempt_idx" ON "score_transfers" USING btree ("institution_id","source_attempt_id","assignment_id","learner_id") WHERE "score_transfers"."source_attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "score_transfers_source_rubric_score_idx" ON "score_transfers" USING btree ("institution_id","source_rubric_score_id") WHERE "score_transfers"."source_rubric_score_id" is not null;--> statement-breakpoint
CREATE INDEX "task_assignment_targets_target_idx" ON "task_assignment_targets" USING btree ("institution_id","target_kind","target_id") WHERE "task_assignment_targets"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "task_assignments_resource_idx" ON "task_assignments" USING btree ("institution_id","resource_id");--> statement-breakpoint
CREATE INDEX "task_assignments_resource_version_idx" ON "task_assignments" USING btree ("institution_id","resource_version_id");--> statement-breakpoint
CREATE INDEX "task_assignments_scoring_version_idx" ON "task_assignments" USING btree ("institution_id","scoring_version_id");--> statement-breakpoint
CREATE INDEX "task_assignments_rubric_version_idx" ON "task_assignments" USING btree ("institution_id","rubric_version_id") WHERE "task_assignments"."rubric_version_id" is not null;--> statement-breakpoint
CREATE INDEX "task_assignments_assigned_by_idx" ON "task_assignments" USING btree ("institution_id","assigned_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_attempts_assignment_learner_number_key" ON "task_attempts" USING btree ("institution_id","assignment_id","learner_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "task_submissions_assignment_learner_key" ON "task_submissions" USING btree ("institution_id","assignment_id","learner_id");--> statement-breakpoint
-- Elle yazıldı: Drizzle şeması ve snapshot tetikleyici ile fonksiyonu izlemez; drizzle-kit yeniden
-- üretirse bu blok yeniden eklenir. Değişmez satırların her `update`/`delete`/`truncate` işlemini
-- 55000 (object_not_in_prerequisite_state) ile reddeder. Uygulama yerelde ve testte tablo sahibi
-- rolle bağlandığı için `revoke` korumaz; tetikleyici her rolde çalışır. Tek atlatma imha işidir:
-- transaction'da `set local kampus.allow_immutable_purge = 'on'` verilirse yalnız satır `delete`'i
-- geçer (veritabani.md §7). Süper kullanıcı isteyen `session_replication_role` kullanılmaz.
CREATE FUNCTION "kampus_reject_immutable_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'kampus: % rows are immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "submission_versions_immutable_trigger" BEFORE UPDATE OR DELETE ON "submission_versions" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "submission_versions_truncate_trigger" BEFORE TRUNCATE ON "submission_versions" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "rubric_scores_immutable_trigger" BEFORE UPDATE OR DELETE ON "rubric_scores" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "rubric_scores_truncate_trigger" BEFORE TRUNCATE ON "rubric_scores" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "resubmission_requests_immutable_trigger" BEFORE UPDATE OR DELETE ON "resubmission_requests" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "resubmission_requests_truncate_trigger" BEFORE TRUNCATE ON "resubmission_requests" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "score_transfers_immutable_trigger" BEFORE UPDATE OR DELETE ON "score_transfers" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "score_transfers_truncate_trigger" BEFORE TRUNCATE ON "score_transfers" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
