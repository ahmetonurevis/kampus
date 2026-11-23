-- Dil okulu kur programı (OG-028, IST-076; DOM-DIL-005…007). Tablo yenidir; kısıtlar `not valid`
-- adımı olmadan tek adımda eklenir. Numara 0028 görev satırında ayrıldı (0027 OG-031'indir). Ad ve
-- e-Özel program kodu tekilliği core anahtarlarındadır (`courseNameKey`, `courseProgramKey`); arşiv
-- satır arşividir (`status = 'archived'` ile `archived_at` birlikte). Sonraki kur bağı aynı kurumun
-- kuruna bileşik yabancı anahtardır; zincir döngüsü, dil ve seviye kuralı core'dadır.
CREATE TABLE "courses" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"language" text NOT NULL,
	"level" text NOT NULL,
	"skill_focus" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"total_hours" integer NOT NULL,
	"weekly_hours" integer NOT NULL,
	"session_minutes" integer NOT NULL,
	"min_learners" integer NOT NULL,
	"max_learners" integer NOT NULL,
	"certified" boolean NOT NULL,
	"next_course_id" uuid,
	"status" text NOT NULL,
	"activated_at" timestamp with time zone,
	"e_ozel_program_code" text,
	"e_ozel_program_key" text,
	"e_ozel_approval" text NOT NULL,
	"e_ozel_recorded_at" timestamp with time zone,
	"e_ozel_recorded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "courses_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "courses_name_check" CHECK (char_length("courses"."name") between 1 and 120),
	CONSTRAINT "courses_description_check" CHECK ("courses"."description" is null or char_length("courses"."description") <= 1000),
	CONSTRAINT "courses_language_check" CHECK ("courses"."language" in ('en', 'de', 'fr', 'es', 'it', 'ru', 'ar', 'zh', 'ja', 'ko', 'tr')),
	CONSTRAINT "courses_level_check" CHECK ("courses"."level" in ('Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2')),
	CONSTRAINT "courses_skill_focus_check" CHECK ("courses"."skill_focus" <@ array['reading', 'listening', 'writing', 'speaking']::text[]),
	CONSTRAINT "courses_hours_check" CHECK ("courses"."total_hours" between 1 and 1200
        and "courses"."weekly_hours" between 1 and 40
        and "courses"."total_hours" >= "courses"."weekly_hours"),
	CONSTRAINT "courses_session_check" CHECK ("courses"."session_minutes" in (45, 90)
        and ("courses"."session_minutes" = 45
          or ("courses"."weekly_hours" % 2 = 0 and "courses"."total_hours" % 2 = 0))),
	CONSTRAINT "courses_learners_check" CHECK ("courses"."min_learners" >= 1 and "courses"."min_learners" <= "courses"."max_learners"
        and "courses"."max_learners" <= 18),
	CONSTRAINT "courses_next_course_check" CHECK ("courses"."next_course_id" <> "courses"."id"),
	CONSTRAINT "courses_status_check" CHECK ("courses"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "courses_lifecycle_check" CHECK (("courses"."status" = 'draft' and "courses"."activated_at" is null and "courses"."archived_at" is null)
        or ("courses"."status" = 'active' and "courses"."activated_at" is not null and "courses"."archived_at" is null)
        or ("courses"."status" = 'archived' and "courses"."archived_at" is not null)),
	CONSTRAINT "courses_e_ozel_approval_check" CHECK ("courses"."e_ozel_approval" in ('not_submitted', 'pending', 'approved', 'rejected')),
	CONSTRAINT "courses_e_ozel_check" CHECK (("courses"."e_ozel_program_code" is null) = ("courses"."e_ozel_program_key" is null)
        and ("courses"."e_ozel_program_code" is null
          or char_length("courses"."e_ozel_program_code") between 1 and 50)
        and (("courses"."e_ozel_approval" = 'not_submitted'
            and "courses"."e_ozel_recorded_at" is null and "courses"."e_ozel_recorded_by_user_id" is null)
          or ("courses"."e_ozel_approval" <> 'not_submitted' and "courses"."e_ozel_program_code" is not null
            and "courses"."e_ozel_recorded_at" is not null and "courses"."e_ozel_recorded_by_user_id" is not null))),
	CONSTRAINT "courses_certified_check" CHECK (not ("courses"."certified" and "courses"."status" = 'active' and "courses"."e_ozel_approval" <> 'approved'))
);
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_next_course_fkey" FOREIGN KEY ("institution_id","next_course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_name_key" ON "courses" USING btree ("institution_id","name_key") WHERE "courses"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_e_ozel_program_key" ON "courses" USING btree ("institution_id","e_ozel_program_key") WHERE "courses"."archived_at" is null and "courses"."e_ozel_program_key" is not null;--> statement-breakpoint
CREATE INDEX "courses_next_course_idx" ON "courses" USING btree ("institution_id","next_course_id");