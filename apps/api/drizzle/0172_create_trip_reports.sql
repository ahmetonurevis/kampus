CREATE TABLE "trip_evaluations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"respondent_role" text NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_evaluations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_evaluations_role_check" CHECK ("trip_evaluations"."respondent_role" in ('veli', 'ogrenci')),
	CONSTRAINT "trip_evaluations_value_check" CHECK ("trip_evaluations"."score" between 1 and 5
        and ("trip_evaluations"."comment" is null or char_length("trip_evaluations"."comment") between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "trip_report_incidents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_report_incidents_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
CREATE TABLE "trip_report_photo_tags" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_report_photo_tags_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
CREATE TABLE "trip_report_photos" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"no_students_visible" boolean NOT NULL,
	"share_with_families" boolean NOT NULL,
	"position" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_report_photos_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_report_photos_report_key" UNIQUE("institution_id","id","report_id"),
	CONSTRAINT "trip_report_photos_text_check" CHECK (("trip_report_photos"."caption" is null or char_length("trip_report_photos"."caption") <= 200)
        and "trip_report_photos"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_reports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"incident_note" text,
	"outcome_note" text,
	"created_by_user_id" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"attendance_source" text,
	"roster_count" integer,
	"attended_count" integer,
	"absent_count" integer,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"return_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_reports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_reports_id_plan_key" UNIQUE("institution_id","id","plan_id"),
	CONSTRAINT "trip_reports_status_check" CHECK ("trip_reports"."status" in ('draft', 'submitted', 'approved', 'returned')),
	CONSTRAINT "trip_reports_text_check" CHECK (("trip_reports"."summary" is null or char_length("trip_reports"."summary") <= 4000)
        and ("trip_reports"."incident_note" is null or char_length("trip_reports"."incident_note") <= 2000)
        and ("trip_reports"."outcome_note" is null or char_length("trip_reports"."outcome_note") <= 4000)
        and ("trip_reports"."return_reason" is null
          or char_length("trip_reports"."return_reason") between 5 and 500)),
	CONSTRAINT "trip_reports_state_check" CHECK (("trip_reports"."submitted_at" is null) = ("trip_reports"."submitted_by_user_id" is null)
        and ("trip_reports"."status" not in ('submitted', 'approved') or ("trip_reports"."submitted_at" is not null
          and "trip_reports"."attendance_source" in ('trip_day', 'none')
          and "trip_reports"."roster_count" >= 0 and "trip_reports"."attended_count" >= 0 and "trip_reports"."absent_count" >= 0))
        and ("trip_reports"."decided_at" is null) = ("trip_reports"."decided_by_user_id" is null)
        and ("trip_reports"."status" not in ('approved', 'returned') or "trip_reports"."decided_at" is not null)
        and ("trip_reports"."status" = 'returned') = ("trip_reports"."return_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "trip_evaluations" ADD CONSTRAINT "trip_evaluations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_evaluations" ADD CONSTRAINT "trip_evaluations_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."trip_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_evaluations" ADD CONSTRAINT "trip_evaluations_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_incidents" ADD CONSTRAINT "trip_report_incidents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_incidents" ADD CONSTRAINT "trip_report_incidents_report_fkey" FOREIGN KEY ("institution_id","report_id") REFERENCES "public"."trip_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_incidents" ADD CONSTRAINT "trip_report_incidents_incident_fkey" FOREIGN KEY ("institution_id","incident_id") REFERENCES "public"."incident_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_photo_tags" ADD CONSTRAINT "trip_report_photo_tags_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_photo_tags" ADD CONSTRAINT "trip_report_photo_tags_photo_fkey" FOREIGN KEY ("institution_id","photo_id","report_id") REFERENCES "public"."trip_report_photos"("institution_id","id","report_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_photos" ADD CONSTRAINT "trip_report_photos_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_photos" ADD CONSTRAINT "trip_report_photos_report_fkey" FOREIGN KEY ("institution_id","report_id") REFERENCES "public"."trip_reports"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_report_photos" ADD CONSTRAINT "trip_report_photos_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reports" ADD CONSTRAINT "trip_reports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reports" ADD CONSTRAINT "trip_reports_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."trip_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_evaluations_respondent_key" ON "trip_evaluations" USING btree ("institution_id","plan_id","membership_id");--> statement-breakpoint
CREATE INDEX "trip_evaluations_membership_idx" ON "trip_evaluations" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "trip_evaluations_student_idx" ON "trip_evaluations" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_report_incidents_report_key" ON "trip_report_incidents" USING btree ("institution_id","report_id","incident_id") WHERE "trip_report_incidents"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_report_incidents_incident_idx" ON "trip_report_incidents" USING btree ("institution_id","incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_report_photo_tags_student_key" ON "trip_report_photo_tags" USING btree ("institution_id","photo_id","student_id") WHERE "trip_report_photo_tags"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_report_photo_tags_photo_idx" ON "trip_report_photo_tags" USING btree ("institution_id","photo_id","report_id");--> statement-breakpoint
CREATE INDEX "trip_report_photo_tags_report_idx" ON "trip_report_photo_tags" USING btree ("institution_id","report_id");--> statement-breakpoint
CREATE INDEX "trip_report_photo_tags_student_idx" ON "trip_report_photo_tags" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_report_photos_file_key" ON "trip_report_photos" USING btree ("institution_id","file_id") WHERE "trip_report_photos"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_report_photos_report_idx" ON "trip_report_photos" USING btree ("institution_id","report_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reports_plan_key" ON "trip_reports" USING btree ("institution_id","plan_id") WHERE "trip_reports"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_reports_status_idx" ON "trip_reports" USING btree ("institution_id","status");--> statement-breakpoint
-- Onaylanan gezi raporu değişmez ve silinmez (DOM-FIN-158, K-529); taslak ve iade edilmiş rapor
-- düzeltilir. Bağ, fotoğraf ve etiket satırları rapor onaylanınca eklenmez, değişmez, silinmez.
-- Uygulama aynı kuralı 422 ile verir; bu son güvencedir. Değerlendirme satırı hiç değişmez.
CREATE FUNCTION "kampus_guard_trip_report"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'kampus: approved trip report is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_trip_report_child"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  report_status text;
  row_report uuid;
  row_institution text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_report := OLD.report_id;
    row_institution := OLD.institution_id;
  ELSE
    row_report := NEW.report_id;
    row_institution := NEW.institution_id;
  END IF;
  SELECT r.status INTO report_status FROM "trip_reports" r
    WHERE r.institution_id = row_institution AND r.id = row_report;
  IF report_status = 'approved' THEN
    RAISE EXCEPTION 'kampus: approved trip report content is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trip_reports_approved_trigger" BEFORE UPDATE OR DELETE ON "trip_reports" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_trip_report"();--> statement-breakpoint
CREATE TRIGGER "trip_report_incidents_approved_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "trip_report_incidents" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_trip_report_child"();--> statement-breakpoint
CREATE TRIGGER "trip_report_photos_approved_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "trip_report_photos" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_trip_report_child"();--> statement-breakpoint
CREATE TRIGGER "trip_report_photo_tags_approved_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "trip_report_photo_tags" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_trip_report_child"();--> statement-breakpoint
CREATE TRIGGER "trip_evaluations_immutable_trigger" BEFORE UPDATE OR DELETE ON "trip_evaluations" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "trip_evaluations_truncate_trigger" BEFORE TRUNCATE ON "trip_evaluations" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "trip_reports" IS 'Gezi sonrası rapor (DOM-FIN-158, ON-158, K-529): gezi planına bağlı tek rapor; gerçekleşme özeti, olay notu, kazanım ve değerlendirme metni. Planın görevlisi öğretmen ya da yönetici yazar; taslak → gönderildi → yönetici onayı ya da gerekçeli iade. Onaylanan rapor değişmez ve silinmez (tetikleyici). Katılım sayıları gönderimde gezi günü yoklamasından dondurulur.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."archived_at" IS 'Arşiv anı; arşivli rapor planın tek rapor kuralına sayılmaz (kısmi tekil indeks).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."id" IS 'Rapor kimliği (UUID; uygulamada üretilir); fotoğraf dosyalarının bağ kimliği (files.attached_id, bağ türü trip_report).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."plan_id" IS 'Gezi planı (trip_plans); planda tek etkin rapor.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."status" IS 'Durum: draft (taslak), submitted (onay bekliyor), approved (onaylandı, değişmez), returned (iade edildi, düzeltilip yeniden gönderilir).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."summary" IS 'Gerçekleşme özeti (serbest metin, en çok 4000; göndermede en az 20). Kişisel veri geçebilir; loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."incident_note" IS 'Olaylar için kısa not (en çok 2000); kaza ve yaralanma ayrıntısı kaza tutanağındadır, buraya yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."outcome_note" IS 'Kazanımlar ve değerlendirme (serbest metin, en çok 4000; göndermede en az 20).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."created_by_user_id" IS 'Raporu açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."submitted_at" IS 'Son gönderim anı; gönderilmiş ve onaylanmış raporda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."submitted_by_user_id" IS 'Son gönderen kullanıcı; gönderim anıyla birlikte.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."attendance_source" IS 'Dondurulan katılımın kaynağı: trip_day (kapanmış yoklama turu var) ya da none (yoklama yapılmadı); gönderimde yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."roster_count" IS 'Gönderimdeki liste: gruplara dağıtılan ya da kapanan turda işaretlenen öğrenci sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."attended_count" IS 'Gönderimde en az bir kapanan turda "var" işaretlenen öğrenci sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."absent_count" IS 'Gönderimde listede olup hiçbir kapanan turda "var" işaretlenmeyen öğrenci sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."decided_at" IS 'Son onay ya da iade anı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."decided_by_user_id" IS 'Son onaylayan ya da iade eden yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_reports"."return_reason" IS 'İade gerekçesi (5–500); yalnız returned durumunda dolu, yeniden gönderimde boşalır. Loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON TABLE "trip_report_incidents" IS 'Gezi raporunun bağlandığı kaza tutanakları (DOM-FIN-158, K-529; DOM-FIN-146): yalnız bağ, tutanak ayrıntısı kopyalanmaz. Olay anı gezinin çıkış–dönüş aralığında olmalı (uygulamada). Taslakta bütün olarak yeniden yazılır; rapor onaylanınca eklenmez, değişmez, silinmez (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."archived_at" IS 'Arşiv anı; raporun bağ listesi değişince eski satır arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."id" IS 'Bağ satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."report_id" IS 'Gezi raporu (trip_reports).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_incidents"."incident_id" IS 'Kaza tutanağı (incident_reports); aynı raporda bir kez.';
--> statement-breakpoint
COMMENT ON TABLE "trip_report_photos" IS 'Gezi raporu fotoğrafı (DOM-FIN-158, K-530): platform dosyası (files, amaç question_image, bağ türü trip_report), açıklama, "öğrenci görünmüyor" işareti ve aileye yayım isteği. Yayım saklanmaz: okuma anında rapor onaylı ve etiketli her öğrencinin geçerli photo_video_sharing rızası varsa ailelere açılır (IST-017); rıza geri çekilince fotoğraf yayından düşer. Rapor onaylanınca donar (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."archived_at" IS 'Arşiv anı; raporundan kaldırılan fotoğraf arşivlenir, dosya bağı çözülür.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."id" IS 'Fotoğraf satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."report_id" IS 'Gezi raporu (trip_reports).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."file_id" IS 'Platform dosyası (files); etkin satırlarda tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."caption" IS 'Kısa açıklama (en çok 200); kişisel veri geçebilir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."no_students_visible" IS 'Fotoğrafta tanınabilir öğrenci yok (manzara, eser); etiket yoksa zorunlu, etiket varken false.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."share_with_families" IS 'Aileye yayım isteği; false ise fotoğraf yalnız iç arşivdedir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."position" IS 'Rapordaki sıra (0 tabanlı).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photos"."created_by_user_id" IS 'Fotoğrafı ekleyen kullanıcı.';
--> statement-breakpoint
COMMENT ON TABLE "trip_report_photo_tags" IS 'Fotoğrafta görünen öğrenci etiketi (DOM-FIN-158, K-530): fotoğrafta öğrenci başına tek etkin satır; öğrenci gezinin katılımcısıdır. Yayım için etiketli öğrencinin geçerli photo_video_sharing rızası aranır (consents). Rapor onaylanınca donar (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."archived_at" IS 'Arşiv anı; etiket kaldırılınca ya da fotoğraf kaldırılınca arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."id" IS 'Etiket satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."report_id" IS 'Gezi raporu (trip_reports); onay kilidi denetimi için fotoğrafla birlikte tutulur.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."photo_id" IS 'Fotoğraf (trip_report_photos).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_report_photo_tags"."student_id" IS 'Etiketlenen öğrencinin records kimliği (yabancı anahtar yok).';
--> statement-breakpoint
COMMENT ON TABLE "trip_evaluations" IS 'Gezi katılımcı değerlendirmesi (DOM-FIN-158, K-531): geziye katılan (kapanan yoklama turunda "var") öğrenci ya da velisinin 1–5 puanı ve isteğe bağlı yorumu; gezide üyelik başına bir kez, dönüşten 30 gün içinde. Değişmez ve silinmez (tetikleyici). Personele ad ve rol olmadan, en az 5 yanıtta özetlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."archived_at" IS 'Arşiv anı; bu tabloda kullanılmaz (değerlendirme değişmez), zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."id" IS 'Değerlendirme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."plan_id" IS 'Gezi planı (trip_plans).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."student_id" IS 'Değerlendirmenin ilgili olduğu katılan öğrencinin records kimliği (veli için çocuğu, öğrenci için kendisi).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."membership_id" IS 'Yanıtlayanın kurum üyeliği; gezide üyelik başına tek satır. Personele dönmez.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."respondent_role" IS 'Yanıtlayanın rolü: veli ya da ogrenci. Personele dönmez.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."score" IS 'Puan: 1 (hiç memnun değilim) – 5 (çok memnunum).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_evaluations"."comment" IS 'İsteğe bağlı yorum (1–500); kişisel veri geçebilir, loga ve denetime yazılmaz.';
