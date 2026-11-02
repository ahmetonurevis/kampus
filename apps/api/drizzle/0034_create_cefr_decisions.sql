-- Seviye tespiti, CEFR seviye kararları ve kur sonu kararları (OG-053; ADR 0004 karar 8; IST-058,
-- IST-060, IST-062; DOM-DIL-010…012, 070; DOM-BEC-030, 034). Tablolar yenidir; kısıtlar `not valid`
-- adımı olmadan tek adımda eklenir. Kural school-core `cefr/*`'tadır. Tespit ve seviye kararında
-- kursiyer `records` kaydına üretilen `learner_collection` kolonuyla; kur sonu kararı dil grubu
-- kaydına, grubuna, kursiyerine ve kuruna bileşik anahtarla; karar veren ve onaylayan
-- `memberships (institution_id, user_id)` tekil indeksine (migration 0001) bağlanır.
-- Elle düzenlenenler: (1) dil grubu tablolarının iki tekil kısıtı (OG-029 tabloları; kur sonu
-- kararının bileşik anahtar hedefi) drizzle-kit'in yazdığı dosya sonundan yabancı anahtarlardan
-- önceye taşındı; küçük tablolardır, kısıt tek adımda eklenir. (2) Dosya sonundaki tetikleyiciler;
-- Drizzle şeması ve snapshot tetikleyiciyi izlemez. drizzle-kit yeniden üretirse ikisi yeniden
-- yapılır.
--
-- Elle taşındı (1): yabancı anahtar hedefleri.
ALTER TABLE "language_group_members" ADD CONSTRAINT "language_group_members_id_group_student_key" UNIQUE("institution_id","id","group_id","student_id");--> statement-breakpoint
ALTER TABLE "language_groups" ADD CONSTRAINT "language_groups_id_course_key" UNIQUE("institution_id","id","course_id");--> statement-breakpoint
CREATE TABLE "level_decisions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"learner_kind" text NOT NULL,
	"learner_id" text NOT NULL,
	"learner_collection" text GENERATED ALWAYS AS (case "learner_kind" when 'student' then 'students' when 'prospect' then 'prospects' end) STORED NOT NULL,
	"kind" text NOT NULL,
	"placement_session_id" uuid,
	"skill" text,
	"level" text NOT NULL,
	"rationale" text NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "level_decisions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "level_decisions_learner_kind_check" CHECK ("level_decisions"."learner_kind" in ('student', 'prospect')),
	CONSTRAINT "level_decisions_kind_check" CHECK ("level_decisions"."kind" in ('placement', 'progression', 'correction')),
	CONSTRAINT "level_decisions_skill_check" CHECK ("level_decisions"."skill" is null or "level_decisions"."skill" in ('reading', 'listening', 'writing', 'speaking', 'mediation', 'language_use')),
	CONSTRAINT "level_decisions_level_check" CHECK ("level_decisions"."level" in ('Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2')),
	CONSTRAINT "level_decisions_rationale_check" CHECK (char_length(btrim("level_decisions"."rationale")) >= 1 and char_length("level_decisions"."rationale") <= 2000),
	CONSTRAINT "level_decisions_placement_check" CHECK (("level_decisions"."kind" = 'placement') = ("level_decisions"."placement_session_id" is not null)),
	CONSTRAINT "level_decisions_evidence_snapshot_check" CHECK (jsonb_typeof("level_decisions"."evidence_snapshot") = 'object' and "level_decisions"."evidence_snapshot" ->> 'schemaVersion' = '2'),
	CONSTRAINT "level_decisions_version_check" CHECK ("level_decisions"."version" = 1 and "level_decisions"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "placement_sessions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"learner_kind" text NOT NULL,
	"learner_id" text NOT NULL,
	"learner_collection" text GENERATED ALWAYS AS (case "learner_kind" when 'student' then 'students' when 'prospect' then 'prospects' end) STORED NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "placement_sessions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "placement_sessions_learner_key" UNIQUE("institution_id","id","learner_kind","learner_id"),
	CONSTRAINT "placement_sessions_learner_kind_check" CHECK ("placement_sessions"."learner_kind" in ('student', 'prospect')),
	CONSTRAINT "placement_sessions_mode_check" CHECK ("placement_sessions"."mode" in ('in_person', 'remote')),
	CONSTRAINT "placement_sessions_completed_check" CHECK ("placement_sessions"."completed_at" is null or "placement_sessions"."completed_at" >= "placement_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "progression_decisions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"outcome" text NOT NULL,
	"status" text NOT NULL,
	"rationale" text NOT NULL,
	"corrects_decision_id" uuid,
	"decided_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"basis" jsonb NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "progression_decisions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "progression_decisions_enrollment_id_key" UNIQUE("institution_id","enrollment_id","id"),
	CONSTRAINT "progression_decisions_outcome_check" CHECK ("progression_decisions"."outcome" in ('passed', 'repeat', 'incomplete_attendance')),
	CONSTRAINT "progression_decisions_status_check" CHECK ("progression_decisions"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "progression_decisions_rationale_check" CHECK (char_length(btrim("progression_decisions"."rationale")) >= 1 and char_length("progression_decisions"."rationale") <= 2000),
	CONSTRAINT "progression_decisions_review_check" CHECK (("progression_decisions"."status" = 'pending') = ("progression_decisions"."reviewed_by_user_id" is null)
        and ("progression_decisions"."reviewed_by_user_id" is null) = ("progression_decisions"."reviewed_at" is null)
        and ("progression_decisions"."status" = 'rejected') = ("progression_decisions"."rejection_reason" is not null)
        and ("progression_decisions"."rejection_reason" is null
          or char_length(btrim("progression_decisions"."rejection_reason")) >= 1 and char_length("progression_decisions"."rejection_reason") <= 2000)
        and ("progression_decisions"."reviewed_at" is null or "progression_decisions"."reviewed_at" >= "progression_decisions"."decided_at")),
	CONSTRAINT "progression_decisions_corrects_check" CHECK ("progression_decisions"."corrects_decision_id" is null or "progression_decisions"."corrects_decision_id" <> "progression_decisions"."id"),
	CONSTRAINT "progression_decisions_basis_check" CHECK (jsonb_typeof("progression_decisions"."basis") = 'object' and "progression_decisions"."basis" ->> 'schemaVersion' = '1'),
	CONSTRAINT "progression_decisions_evidence_snapshot_check" CHECK (jsonb_typeof("progression_decisions"."evidence_snapshot") = 'object' and "progression_decisions"."evidence_snapshot" ->> 'schemaVersion' = '2')
);
--> statement-breakpoint
ALTER TABLE "level_decisions" ADD CONSTRAINT "level_decisions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_decisions" ADD CONSTRAINT "level_decisions_learner_fkey" FOREIGN KEY ("institution_id","learner_collection","learner_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_decisions" ADD CONSTRAINT "level_decisions_placement_session_fkey" FOREIGN KEY ("institution_id","placement_session_id","learner_kind","learner_id") REFERENCES "public"."placement_sessions"("institution_id","id","learner_kind","learner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_decisions" ADD CONSTRAINT "level_decisions_decided_by_fkey" FOREIGN KEY ("institution_id","decided_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_sessions" ADD CONSTRAINT "placement_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_sessions" ADD CONSTRAINT "placement_sessions_learner_fkey" FOREIGN KEY ("institution_id","learner_collection","learner_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_sessions" ADD CONSTRAINT "placement_sessions_form_fkey" FOREIGN KEY ("institution_id","form_id") REFERENCES "public"."resources"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_sessions" ADD CONSTRAINT "placement_sessions_form_version_fkey" FOREIGN KEY ("institution_id","form_version_id") REFERENCES "public"."resource_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_enrollment_fkey" FOREIGN KEY ("institution_id","enrollment_id","group_id","learner_id") REFERENCES "public"."language_group_members"("institution_id","id","group_id","student_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_group_fkey" FOREIGN KEY ("institution_id","group_id","course_id") REFERENCES "public"."language_groups"("institution_id","id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_corrects_fkey" FOREIGN KEY ("institution_id","enrollment_id","corrects_decision_id") REFERENCES "public"."progression_decisions"("institution_id","enrollment_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_decided_by_fkey" FOREIGN KEY ("institution_id","decided_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_decisions" ADD CONSTRAINT "progression_decisions_reviewed_by_fkey" FOREIGN KEY ("institution_id","reviewed_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "level_decisions_placement_skill_key" ON "level_decisions" USING btree ("institution_id","placement_session_id",coalesce("skill", 'overall')) WHERE "level_decisions"."placement_session_id" is not null;--> statement-breakpoint
CREATE INDEX "level_decisions_learner_idx" ON "level_decisions" USING btree ("institution_id","learner_id","decided_at");--> statement-breakpoint
CREATE INDEX "level_decisions_placement_session_idx" ON "level_decisions" USING btree ("institution_id","placement_session_id");--> statement-breakpoint
CREATE INDEX "level_decisions_decided_by_idx" ON "level_decisions" USING btree ("institution_id","decided_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "placement_sessions_in_progress_key" ON "placement_sessions" USING btree ("institution_id","learner_kind","learner_id") WHERE "placement_sessions"."completed_at" is null and "placement_sessions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "placement_sessions_learner_idx" ON "placement_sessions" USING btree ("institution_id","learner_id","started_at");--> statement-breakpoint
CREATE INDEX "placement_sessions_form_idx" ON "placement_sessions" USING btree ("institution_id","form_id");--> statement-breakpoint
CREATE INDEX "placement_sessions_form_version_idx" ON "placement_sessions" USING btree ("institution_id","form_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_decisions_pending_key" ON "progression_decisions" USING btree ("institution_id","enrollment_id") WHERE "progression_decisions"."status" = 'pending' and "progression_decisions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "progression_decisions_enrollment_idx" ON "progression_decisions" USING btree ("institution_id","enrollment_id","decided_at");--> statement-breakpoint
CREATE INDEX "progression_decisions_group_idx" ON "progression_decisions" USING btree ("institution_id","group_id","course_id");--> statement-breakpoint
CREATE INDEX "progression_decisions_course_idx" ON "progression_decisions" USING btree ("institution_id","course_id");--> statement-breakpoint
CREATE INDEX "progression_decisions_learner_idx" ON "progression_decisions" USING btree ("institution_id","learner_id","decided_at");--> statement-breakpoint
CREATE INDEX "progression_decisions_corrects_idx" ON "progression_decisions" USING btree ("institution_id","enrollment_id","corrects_decision_id");--> statement-breakpoint
CREATE INDEX "progression_decisions_decided_by_idx" ON "progression_decisions" USING btree ("institution_id","decided_by_user_id");--> statement-breakpoint
CREATE INDEX "progression_decisions_reviewed_by_idx" ON "progression_decisions" USING btree ("institution_id","reviewed_by_user_id");--> statement-breakpoint
-- Elle yazıldı: `level_decisions` karar geçmişidir; satır hiç değişmez, yeni karar yeni satırdır
-- (ADR 0004 karar 8, core `cefrProfileView`). Ortak `kampus_reject_immutable_change()` (migration
-- 0013) her `update`/`delete`/`truncate`'i 55000 ile reddeder; yalnız imha işi
-- `set local kampus.allow_immutable_purge = 'on'` ile `delete` yapar.
CREATE TRIGGER "level_decisions_immutable_trigger" BEFORE UPDATE OR DELETE ON "level_decisions" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "level_decisions_truncate_trigger" BEFORE TRUNCATE ON "level_decisions" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
-- Elle yazıldı: kur sonu kararı `pending` iken koordinatör bir kez onaylar ya da reddeder
-- (core `planProgressionReview`); sonuçlanmış karar değişmez, düzeltme yeni satırdır. Koşul
-- `old.status` üzerindedir: açık karar güncellenebilir, sonuçlanmışın `update`/`delete`'i 55000.
CREATE TRIGGER "progression_decisions_decided_trigger" BEFORE UPDATE OR DELETE ON "progression_decisions" FOR EACH ROW WHEN (OLD."status" <> 'pending') EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "progression_decisions_truncate_trigger" BEFORE TRUNCATE ON "progression_decisions" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
