-- Kurum başarı belgesi, belge sayacı ve MEBBİS belge izi (OG-088; IST-081; DOM-DIL-080, 081, 082).
-- Tablolar yenidir; kısıtlar `not valid` adımı olmadan tek adımda eklenir. Kural school-core
-- `cefr/certificates.ts`'tedir. Belge kayda, gruba, kursiyere, kura ve karara bileşik anahtarla
-- bağlanır. Kurumsuz indeks istisnası: `course_certificates_verification_code_key` yalnız kod
-- üzerindedir (kimliksiz doğrulama ucu kurum kimliği okumaz; şema yorumu `schema/certificates.ts`).
-- Elle eklenenler: dosya sonundaki tetikleyiciler ve iki koruma fonksiyonu; Drizzle şeması ve
-- snapshot onları izlemez, drizzle-kit yeniden üretirse yeniden yazılır.
CREATE TABLE "certificate_counters" (
	"institution_id" text NOT NULL,
	"last_serial" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "certificate_counters_pkey" PRIMARY KEY("institution_id"),
	CONSTRAINT "certificate_counters_last_serial_check" CHECK ("certificate_counters"."last_serial" >= 1)
);
--> statement-breakpoint
CREATE TABLE "course_certificates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"serial" integer NOT NULL,
	"number" text NOT NULL,
	"verification_code" text NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"decision_id" uuid NOT NULL,
	"status" text NOT NULL,
	"content" jsonb NOT NULL,
	"replaces_certificate_id" uuid,
	"issued_by_user_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "course_certificates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "course_certificates_enrollment_id_key" UNIQUE("institution_id","enrollment_id","id"),
	CONSTRAINT "course_certificates_status_check" CHECK ("course_certificates"."status" in ('valid', 'cancelled')),
	CONSTRAINT "course_certificates_serial_check" CHECK ("course_certificates"."serial" >= 1),
	CONSTRAINT "course_certificates_number_check" CHECK ("course_certificates"."number" ~ '^KB-[0-9]{4}-[0-9]{6,}$'),
	CONSTRAINT "course_certificates_verification_code_check" CHECK ("course_certificates"."verification_code" ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$'),
	CONSTRAINT "course_certificates_content_check" CHECK (jsonb_typeof("course_certificates"."content") = 'object' and "course_certificates"."content" ->> 'schemaVersion' = '1'),
	CONSTRAINT "course_certificates_cancellation_check" CHECK (("course_certificates"."status" = 'cancelled') = ("course_certificates"."cancelled_by_user_id" is not null)
        and ("course_certificates"."cancelled_by_user_id" is null) = ("course_certificates"."cancelled_at" is null)
        and ("course_certificates"."cancelled_by_user_id" is null) = ("course_certificates"."cancellation_reason" is null)
        and ("course_certificates"."cancellation_reason" is null
          or (char_length(btrim("course_certificates"."cancellation_reason")) >= 1
            and char_length("course_certificates"."cancellation_reason") <= 500))
        and ("course_certificates"."cancelled_at" is null or "course_certificates"."cancelled_at" >= "course_certificates"."issued_at")),
	CONSTRAINT "course_certificates_replaces_check" CHECK ("course_certificates"."replaces_certificate_id" is null or "course_certificates"."replaces_certificate_id" <> "course_certificates"."id"),
	CONSTRAINT "course_certificates_archived_check" CHECK ("course_certificates"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "mebbis_certificate_records" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"learner_id" text NOT NULL,
	"decision_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"issued_date" date NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mebbis_certificate_records_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "mebbis_certificate_records_number_check" CHECK (char_length(btrim("mebbis_certificate_records"."certificate_number")) >= 1 and char_length("mebbis_certificate_records"."certificate_number") <= 100),
	CONSTRAINT "mebbis_certificate_records_version_check" CHECK ("mebbis_certificate_records"."version" = 1 and "mebbis_certificate_records"."archived_at" is null)
);
--> statement-breakpoint
ALTER TABLE "certificate_counters" ADD CONSTRAINT "certificate_counters_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_enrollment_fkey" FOREIGN KEY ("institution_id","enrollment_id","group_id","learner_id") REFERENCES "public"."language_group_members"("institution_id","id","group_id","student_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_group_fkey" FOREIGN KEY ("institution_id","group_id","course_id") REFERENCES "public"."language_groups"("institution_id","id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_decision_fkey" FOREIGN KEY ("institution_id","enrollment_id","decision_id") REFERENCES "public"."progression_decisions"("institution_id","enrollment_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_replaces_fkey" FOREIGN KEY ("institution_id","enrollment_id","replaces_certificate_id") REFERENCES "public"."course_certificates"("institution_id","enrollment_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_issued_by_fkey" FOREIGN KEY ("institution_id","issued_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_cancelled_by_fkey" FOREIGN KEY ("institution_id","cancelled_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mebbis_certificate_records" ADD CONSTRAINT "mebbis_certificate_records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mebbis_certificate_records" ADD CONSTRAINT "mebbis_certificate_records_enrollment_fkey" FOREIGN KEY ("institution_id","enrollment_id","group_id","learner_id") REFERENCES "public"."language_group_members"("institution_id","id","group_id","student_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mebbis_certificate_records" ADD CONSTRAINT "mebbis_certificate_records_decision_fkey" FOREIGN KEY ("institution_id","enrollment_id","decision_id") REFERENCES "public"."progression_decisions"("institution_id","enrollment_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mebbis_certificate_records" ADD CONSTRAINT "mebbis_certificate_records_recorded_by_fkey" FOREIGN KEY ("institution_id","recorded_by_user_id") REFERENCES "public"."memberships"("institution_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_serial_key" ON "course_certificates" USING btree ("institution_id","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_number_key" ON "course_certificates" USING btree ("institution_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_verification_code_key" ON "course_certificates" USING btree ("verification_code");--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_valid_enrollment_key" ON "course_certificates" USING btree ("institution_id","enrollment_id") WHERE "course_certificates"."status" = 'valid';--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_replaces_key" ON "course_certificates" USING btree ("institution_id","replaces_certificate_id") WHERE "course_certificates"."replaces_certificate_id" is not null;--> statement-breakpoint
CREATE INDEX "course_certificates_enrollment_idx" ON "course_certificates" USING btree ("institution_id","enrollment_id","group_id","learner_id");--> statement-breakpoint
CREATE INDEX "course_certificates_decision_idx" ON "course_certificates" USING btree ("institution_id","enrollment_id","decision_id");--> statement-breakpoint
CREATE INDEX "course_certificates_replaces_idx" ON "course_certificates" USING btree ("institution_id","enrollment_id","replaces_certificate_id");--> statement-breakpoint
CREATE INDEX "course_certificates_group_idx" ON "course_certificates" USING btree ("institution_id","group_id","course_id");--> statement-breakpoint
CREATE INDEX "course_certificates_course_idx" ON "course_certificates" USING btree ("institution_id","course_id");--> statement-breakpoint
CREATE INDEX "course_certificates_learner_idx" ON "course_certificates" USING btree ("institution_id","learner_id");--> statement-breakpoint
CREATE INDEX "course_certificates_issued_by_idx" ON "course_certificates" USING btree ("institution_id","issued_by_user_id");--> statement-breakpoint
CREATE INDEX "course_certificates_cancelled_by_idx" ON "course_certificates" USING btree ("institution_id","cancelled_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mebbis_certificate_records_decision_key" ON "mebbis_certificate_records" USING btree ("institution_id","decision_id");--> statement-breakpoint
CREATE INDEX "mebbis_certificate_records_enrollment_idx" ON "mebbis_certificate_records" USING btree ("institution_id","enrollment_id","group_id","learner_id");--> statement-breakpoint
CREATE INDEX "mebbis_certificate_records_enrollment_decision_idx" ON "mebbis_certificate_records" USING btree ("institution_id","enrollment_id","decision_id");--> statement-breakpoint
CREATE INDEX "mebbis_certificate_records_group_idx" ON "mebbis_certificate_records" USING btree ("institution_id","group_id");--> statement-breakpoint
CREATE INDEX "mebbis_certificate_records_recorded_by_idx" ON "mebbis_certificate_records" USING btree ("institution_id","recorded_by_user_id");--> statement-breakpoint
-- Elle yazıldı: belge sayacı yalnız artar (DOM-DIL-082, numara yeniden kullanılmaz). Kurum
-- değişikliği, azalan ya da aynı kalan sıra ve silme 55000'dir; yalnız imha işi
-- `kampus.allow_immutable_purge` ile siler (`kampus_reject_immutable_change` ile aynı kural).
CREATE FUNCTION "kampus_certificate_counter_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'kampus: % rows are immutable (%)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF NEW."institution_id" IS DISTINCT FROM OLD."institution_id"
     OR NEW."last_serial" <= OLD."last_serial" THEN
    RAISE EXCEPTION 'kampus: % only increases', TG_TABLE_NAME
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "certificate_counters_guard_trigger" BEFORE UPDATE OR DELETE ON "certificate_counters" FOR EACH ROW EXECUTE FUNCTION "kampus_certificate_counter_guard"();--> statement-breakpoint
CREATE TRIGGER "certificate_counters_truncate_trigger" BEFORE TRUNCATE ON "certificate_counters" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
-- Elle yazıldı: düzenlenmiş belge değişmez (DOM-DIL-082). Geçerli belgede yalnız iptal alanları
-- (`status` → `cancelled`, `cancelled_by_user_id`, `cancelled_at`, `cancellation_reason`) ile
-- `updated_at` ve `version` bir kez yazılır; içerik, numara, kod, bağlar, düzenleyen ve an
-- değişirse 55000. İptal edilmiş belgenin her `update`'i ve her `delete` 55000 (yalnız imha işi
-- `kampus.allow_immutable_purge` ile siler).
CREATE FUNCTION "kampus_certificate_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'kampus: % rows are immutable (%)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF OLD."status" <> 'valid' OR NEW."status" <> 'cancelled' THEN
    RAISE EXCEPTION 'kampus: % rows accept only a single cancellation', TG_TABLE_NAME
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF (NEW."institution_id", NEW."id", NEW."serial", NEW."number", NEW."verification_code",
      NEW."enrollment_id", NEW."group_id", NEW."course_id", NEW."learner_id", NEW."decision_id",
      NEW."content", NEW."replaces_certificate_id", NEW."issued_by_user_id", NEW."issued_at",
      NEW."created_at", NEW."archived_at")
    IS DISTINCT FROM
     (OLD."institution_id", OLD."id", OLD."serial", OLD."number", OLD."verification_code",
      OLD."enrollment_id", OLD."group_id", OLD."course_id", OLD."learner_id", OLD."decision_id",
      OLD."content", OLD."replaces_certificate_id", OLD."issued_by_user_id", OLD."issued_at",
      OLD."created_at", OLD."archived_at") THEN
    RAISE EXCEPTION 'kampus: issued % rows accept only cancellation changes', TG_TABLE_NAME
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "course_certificates_guard_trigger" BEFORE UPDATE OR DELETE ON "course_certificates" FOR EACH ROW EXECUTE FUNCTION "kampus_certificate_guard"();--> statement-breakpoint
CREATE TRIGGER "course_certificates_truncate_trigger" BEFORE TRUNCATE ON "course_certificates" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
-- Elle yazıldı: MEBBİS izi değişmez satırdır (DOM-DIL-080); ortak
-- `kampus_reject_immutable_change()` (migration 0013).
CREATE TRIGGER "mebbis_certificate_records_immutable_trigger" BEFORE UPDATE OR DELETE ON "mebbis_certificate_records" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "mebbis_certificate_records_truncate_trigger" BEFORE TRUNCATE ON "mebbis_certificate_records" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
