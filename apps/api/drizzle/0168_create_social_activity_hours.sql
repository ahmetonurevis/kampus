CREATE TABLE "social_activities" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"location" text NOT NULL,
	"responsible_membership_id" text NOT NULL,
	"organization_scope" text NOT NULL,
	"organization_name" text,
	"club_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_activities_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "social_activities_name_check" CHECK (char_length("social_activities"."name") between 2 and 120),
	CONSTRAINT "social_activities_kind_check" CHECK ("social_activities"."kind" in ('club', 'volunteering')),
	CONSTRAINT "social_activities_scope_check" CHECK ("social_activities"."organization_scope" in ('internal', 'external')),
	CONSTRAINT "social_activities_location_check" CHECK (char_length("social_activities"."location") between 2 and 160),
	CONSTRAINT "social_activities_organization_check" CHECK (("social_activities"."organization_name" is null or char_length("social_activities"."organization_name") between 2 and 160)
        and ("social_activities"."organization_scope" = 'internal' or "social_activities"."organization_name" is not null)),
	CONSTRAINT "social_activities_dates_check" CHECK ("social_activities"."end_date" is null or "social_activities"."end_date" >= "social_activities"."start_date"),
	CONSTRAINT "social_activities_club_check" CHECK ("social_activities"."club_id" is null or "social_activities"."kind" = 'club')
);
--> statement-breakpoint
CREATE TABLE "social_activity_hours" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"activity_date" date NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"entered_by_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"reverses_entry_id" uuid,
	"reversed_by_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_activity_hours_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "social_activity_hours_kind_check" CHECK ("social_activity_hours"."kind" in ('entry', 'reversal')),
	CONSTRAINT "social_activity_hours_status_check" CHECK ("social_activity_hours"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "social_activity_hours_source_check" CHECK ("social_activity_hours"."source" in ('teacher', 'student')),
	CONSTRAINT "social_activity_hours_minutes_check" CHECK ("social_activity_hours"."minutes" % 30 = 0 and (
        ("social_activity_hours"."kind" = 'entry' and "social_activity_hours"."minutes" between 30 and 600)
        or ("social_activity_hours"."kind" = 'reversal' and "social_activity_hours"."minutes" between -600 and -30))),
	CONSTRAINT "social_activity_hours_reversal_check" CHECK (("social_activity_hours"."kind" = 'reversal') = ("social_activity_hours"."reverses_entry_id" is not null)
        and ("social_activity_hours"."kind" = 'entry' or ("social_activity_hours"."status" = 'approved' and "social_activity_hours"."reversed_by_entry_id" is null))
        and ("social_activity_hours"."reversed_by_entry_id" is null or ("social_activity_hours"."kind" = 'entry' and "social_activity_hours"."status" = 'approved'))),
	CONSTRAINT "social_activity_hours_decision_check" CHECK (("social_activity_hours"."status" = 'pending') = ("social_activity_hours"."decided_by_user_id" is null)
        and ("social_activity_hours"."decided_by_user_id" is null) = ("social_activity_hours"."decided_at" is null)
        and ("social_activity_hours"."status" = 'rejected') = ("social_activity_hours"."rejection_reason" is not null)
        and ("social_activity_hours"."rejection_reason" is null or char_length("social_activity_hours"."rejection_reason") between 1 and 500)),
	CONSTRAINT "social_activity_hours_note_check" CHECK ("social_activity_hours"."note" is null or char_length("social_activity_hours"."note") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "social_activity_settings" (
	"institution_id" text NOT NULL,
	"total_target_hours" integer NOT NULL,
	"yearly_target_hours" integer,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_activity_settings_pkey" PRIMARY KEY("institution_id"),
	CONSTRAINT "social_activity_settings_targets_check" CHECK ("social_activity_settings"."total_target_hours" between 1 and 200
        and ("social_activity_settings"."yearly_target_hours" is null or "social_activity_settings"."yearly_target_hours" between 1 and 200))
);
--> statement-breakpoint
ALTER TABLE "social_activities" ADD CONSTRAINT "social_activities_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activities" ADD CONSTRAINT "social_activities_responsible_fkey" FOREIGN KEY ("institution_id","responsible_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activities" ADD CONSTRAINT "social_activities_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity_hours" ADD CONSTRAINT "social_activity_hours_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity_hours" ADD CONSTRAINT "social_activity_hours_activity_fkey" FOREIGN KEY ("institution_id","activity_id") REFERENCES "public"."social_activities"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity_hours" ADD CONSTRAINT "social_activity_hours_reverses_fkey" FOREIGN KEY ("institution_id","reverses_entry_id") REFERENCES "public"."social_activity_hours"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity_settings" ADD CONSTRAINT "social_activity_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_activities_responsible_idx" ON "social_activities" USING btree ("institution_id","responsible_membership_id");--> statement-breakpoint
CREATE INDEX "social_activities_club_idx" ON "social_activities" USING btree ("institution_id","club_id") WHERE "social_activities"."club_id" is not null;--> statement-breakpoint
CREATE INDEX "social_activities_start_idx" ON "social_activities" USING btree ("institution_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "social_activity_hours_day_key" ON "social_activity_hours" USING btree ("institution_id","activity_id","student_id","activity_date") WHERE "social_activity_hours"."kind" = 'entry' and "social_activity_hours"."status" <> 'rejected' and "social_activity_hours"."reversed_by_entry_id" is null and "social_activity_hours"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_activity_hours_reverses_key" ON "social_activity_hours" USING btree ("institution_id","reverses_entry_id") WHERE "social_activity_hours"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "social_activity_hours_student_idx" ON "social_activity_hours" USING btree ("institution_id","student_id","activity_date");--> statement-breakpoint
CREATE INDEX "social_activity_hours_activity_idx" ON "social_activity_hours" USING btree ("institution_id","activity_id","status");--> statement-breakpoint
-- Sosyal etkinlik saati (DOM-FIN-160, K-536): kaydın öğrencisi, etkinliği, günü, türü, dakikası,
-- kaynağı ve girişi hiç değişmez. Bekleyen beyana bir kez karar yazılır (onay ya da gerekçeli ret);
-- karar verilmiş kayıt değişmez. Onaylı kayda tek değişiklik ters kayıt bağının bir kez yazılmasıdır.
-- Satır silinmez (yalnız imha işi). Uygulama aynı kuralları 409 ile verir; bunlar son güvencedir.
CREATE FUNCTION "kampus_guard_social_activity_hour"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'kampus: social activity hours are not deleted (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.activity_id IS DISTINCT FROM OLD.activity_id
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.activity_date IS DISTINCT FROM OLD.activity_date
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.minutes IS DISTINCT FROM OLD.minutes
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.entered_by_user_id IS DISTINCT FROM OLD.entered_by_user_id
    OR NEW.reverses_entry_id IS DISTINCT FROM OLD.reverses_entry_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'kampus: social activity hour is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF OLD.status = 'pending' AND OLD.reversed_by_entry_id IS NULL
    AND NEW.reversed_by_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND OLD.kind = 'entry'
    AND OLD.reversed_by_entry_id IS NULL AND NEW.reversed_by_entry_id IS NOT NULL
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.decided_by_user_id IS NOT DISTINCT FROM OLD.decided_by_user_id
    AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
    AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: decided social activity hour is immutable (%)', TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "social_activity_hours_guard_trigger" BEFORE UPDATE OR DELETE ON "social_activity_hours" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_social_activity_hour"();--> statement-breakpoint
CREATE TRIGGER "social_activity_hours_truncate_trigger" BEFORE TRUNCATE ON "social_activity_hours" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "social_activities" IS 'Lise sosyal etkinliği (DOM-FIN-160, ON-170, K-535): kulüp/topluluk çalışması ya da gönüllülük faaliyeti. Yalnız school türü kurumda. Sorumlu öğretmen ya da yönetici saat girer, öğrenci beyanını onaylar. Arşivli etkinliğe saat yazılmaz; onaylı saatleri belgede kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."id" IS 'Etkinlik kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."name" IS 'Etkinlik adı (2–120).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."kind" IS 'Tür: club kulüp/topluluk çalışması, volunteering gönüllülük/toplum hizmeti.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."start_date" IS 'Başlangıç günü (Europe/Istanbul takvim günü); saat bu günden önceye yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."end_date" IS 'Bitiş günü (dahil); boşsa süren etkinlik. Saat kaydı olan günler aralık dışına bırakılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."location" IS 'Etkinliğin yapıldığı yer (2–160).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."responsible_membership_id" IS 'Sorumlu öğretmenin ya da yöneticinin kurum üyeliği; saat girer ve beyanı onaylar. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."organization_scope" IS 'internal kurum içi, external kurum dışı (dış kuruluşla).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."organization_name" IS 'Kuruluş adı (2–160); kurum dışında zorunlu, kurum içinde isteğe bağlı.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."club_id" IS 'Bağlı kulüp (school_clubs, ON-098); yalnız kulüp çalışmasında, isteğe bağlı.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."created_by_user_id" IS 'Etkinliği açan kullanıcı. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."archived_at" IS 'Arşiv anı (UTC); arşivli etkinlik listede görünmez, saat almaz.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activities"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "social_activity_hours" IS 'Lise sosyal etkinlik saati (DOM-FIN-160, ON-170, K-536): öğrenci × etkinlik × gün kaydı ya da onaylı kaydı düzelten ters kayıt. Öğretmen girişi onaylı, öğrenci beyanı onay bekler. Karar verilmiş kayıt değişmez, silinmez (tetikleyici); aynı gün ve etkinliğin etkin kaydı tektir. Özet ve belge yalnız onaylı net dakikayı sayar.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."id" IS 'Saat kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."activity_id" IS 'Etkinlik (social_activities).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."student_id" IS 'Öğrencinin records kimliği (yabancı anahtar yok); girişte etkin 9–12. sınıf öğrencisidir. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."activity_date" IS 'Çalışma günü (Europe/Istanbul takvim günü); bugünü geçmez, etkinlik aralığındadır. Öğretim yılı bu günden türetilir.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."kind" IS 'entry saat kaydı, reversal onaylı kaydı düzelten ters kayıt.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."minutes" IS 'Dakika, 30 dakika adımlı: kayıtta 30–600, ters kayıtta düzelttiği kaydın eksisi.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."status" IS 'pending onay bekliyor, approved onaylandı, rejected reddedildi; ters kayıt her zaman onaylıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."source" IS 'teacher sorumlu öğretmen ya da yönetici girişi, student öğrenci beyanı.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."note" IS 'Kayıtta yapılan çalışmanın kısa açıklaması, ters kayıtta düzeltme gerekçesi (≤ 500). Serbest metin, kişisel veri; loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."entered_by_user_id" IS 'Kaydı giren ya da beyan eden kullanıcı. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."decided_by_user_id" IS 'Onaylayan ya da reddeden kullanıcı; bekleyen kayıtta boş. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."decided_at" IS 'Karar anı (UTC); bekleyen kayıtta boş.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."rejection_reason" IS 'Ret gerekçesi (≤ 500); yalnız reddedilen kayıtta, öğrenci ve veli görür. Serbest metin, kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."reverses_entry_id" IS 'Ters kaydın düzelttiği onaylı kayıt; kayıt başına tek ters kayıt.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."reversed_by_entry_id" IS 'Onaylı kaydı düzelten ters kayıt; bir kez yazılır, sonra kayıt belgeden ve toplamdan düşer.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."archived_at" IS 'Kullanılmaz (kayıt arşivlenmez, ters kayıtla düzeltilir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_hours"."version" IS 'İyimser kilit sürümü (If-Match; onay, ret ve ters kayıt).';
--> statement-breakpoint
COMMENT ON TABLE "social_activity_settings" IS 'Kurumun sosyal etkinlik hedefleri (DOM-FIN-160, K-537): kurum başına tek satır. Satır yoksa mevzuat önerisi uygulanır (toplam 40, yıllık 10 saat; H-115).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."institution_id" IS 'Kurum; birincil anahtar.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."total_target_hours" IS 'Ortaöğrenim boyunca hedef, tam saat (1–200).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."yearly_target_hours" IS 'Öğretim yılı hedefi, tam saat (1–200); boşsa yıllık hedef yok.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."updated_by_user_id" IS 'Hedefi son değiştiren kullanıcı. Kişisel veri.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."created_at" IS 'Kaydın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."archived_at" IS 'Kullanılmaz (ayar arşivlenmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "social_activity_settings"."version" IS 'İyimser kilit sürümü (If-Match; satır yokken 0).';
