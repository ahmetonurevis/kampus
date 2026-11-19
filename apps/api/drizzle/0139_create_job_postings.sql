CREATE TABLE "job_application_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"retention_months" integer DEFAULT 12 NOT NULL,
	"privacy_notice_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_application_settings_retention_check" CHECK ("job_application_settings"."retention_months" between 1 and 60),
	CONSTRAINT "job_application_settings_notice_check" CHECK ("job_application_settings"."privacy_notice_version" is null or char_length("job_application_settings"."privacy_notice_version") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "job_application_stage_changes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"job_application_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"changed_on" date NOT NULL,
	"changed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_application_stage_changes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "job_application_stage_changes_to_check" CHECK ("job_application_stage_changes"."to_stage" in ('new', 'screening', 'interview', 'offer', 'hired', 'rejected')),
	CONSTRAINT "job_application_stage_changes_from_check" CHECK ("job_application_stage_changes"."from_stage" is null or "job_application_stage_changes"."from_stage" in ('new', 'screening', 'interview', 'offer', 'hired', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"job_posting_id" uuid NOT NULL,
	"candidate_name" text NOT NULL,
	"email" text,
	"phone" text,
	"channel" text NOT NULL,
	"received_on" date NOT NULL,
	"cv_file_id" uuid,
	"privacy_notice_version" text NOT NULL,
	"privacy_notice_shown_on" date NOT NULL,
	"note" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"stage_changed_on" date NOT NULL,
	"anonymized_at" timestamp with time zone,
	"anonymization_reason" text,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_applications_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "job_applications_channel_check" CHECK ("job_applications"."channel" in ('website', 'email', 'in_person', 'referral')),
	CONSTRAINT "job_applications_stage_check" CHECK ("job_applications"."stage" in ('new', 'screening', 'interview', 'offer', 'hired', 'rejected')),
	CONSTRAINT "job_applications_reason_check" CHECK ("job_applications"."anonymization_reason" is null or "job_applications"."anonymization_reason" in ('retention_expired', 'data_subject_request')),
	CONSTRAINT "job_applications_name_check" CHECK (char_length("job_applications"."candidate_name") between 2 and 120),
	CONSTRAINT "job_applications_notice_check" CHECK (char_length("job_applications"."privacy_notice_version") between 1 and 40),
	CONSTRAINT "job_applications_note_check" CHECK ("job_applications"."note" is null or char_length("job_applications"."note") between 1 and 1000),
	CONSTRAINT "job_applications_contact_check" CHECK ("job_applications"."anonymized_at" is not null or "job_applications"."email" is not null or "job_applications"."phone" is not null),
	CONSTRAINT "job_applications_anonymized_check" CHECK (("job_applications"."anonymized_at" is null) = ("job_applications"."anonymization_reason" is null) and ("job_applications"."anonymized_at" is null or ("job_applications"."email" is null and "job_applications"."phone" is null and "job_applications"."note" is null and "job_applications"."cv_file_id" is null))),
	CONSTRAINT "job_applications_stage_day_check" CHECK ("job_applications"."stage_changed_on" >= "job_applications"."received_on")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text NOT NULL,
	"employment_type" text NOT NULL,
	"description" text NOT NULL,
	"requirements" text,
	"publish_on" date NOT NULL,
	"deadline_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closed_on" date,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_postings_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "job_postings_status_check" CHECK ("job_postings"."status" in ('draft', 'published', 'closed')),
	CONSTRAINT "job_postings_employment_type_check" CHECK ("job_postings"."employment_type" in ('full_time', 'part_time', 'extra_lessons')),
	CONSTRAINT "job_postings_title_check" CHECK (char_length("job_postings"."title") between 2 and 160),
	CONSTRAINT "job_postings_position_check" CHECK (char_length("job_postings"."position") between 2 and 120),
	CONSTRAINT "job_postings_description_check" CHECK (char_length("job_postings"."description") between 10 and 4000),
	CONSTRAINT "job_postings_requirements_check" CHECK ("job_postings"."requirements" is null or char_length("job_postings"."requirements") between 1 and 4000),
	CONSTRAINT "job_postings_deadline_check" CHECK ("job_postings"."deadline_on" >= "job_postings"."publish_on"),
	CONSTRAINT "job_postings_closed_check" CHECK (("job_postings"."status" = 'closed') = ("job_postings"."closed_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "job_application_settings" ADD CONSTRAINT "job_application_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application_stage_changes" ADD CONSTRAINT "job_application_stage_changes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application_stage_changes" ADD CONSTRAINT "job_application_stage_changes_application_fkey" FOREIGN KEY ("institution_id","job_application_id") REFERENCES "public"."job_applications"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_posting_fkey" FOREIGN KEY ("institution_id","job_posting_id") REFERENCES "public"."job_postings"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_cv_file_fkey" FOREIGN KEY ("institution_id","cv_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_application_stage_changes_application_idx" ON "job_application_stage_changes" USING btree ("institution_id","job_application_id");--> statement-breakpoint
CREATE INDEX "job_applications_posting_idx" ON "job_applications" USING btree ("institution_id","job_posting_id");--> statement-breakpoint
CREATE INDEX "job_applications_stage_idx" ON "job_applications" USING btree ("institution_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_email_key" ON "job_applications" USING btree ("institution_id","job_posting_id","email") WHERE "job_applications"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_phone_key" ON "job_applications" USING btree ("institution_id","job_posting_id","phone") WHERE "job_applications"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_cv_file_key" ON "job_applications" USING btree ("institution_id","cv_file_id") WHERE "job_applications"."cv_file_id" is not null;--> statement-breakpoint
CREATE INDEX "job_postings_status_idx" ON "job_postings" USING btree ("institution_id","status");--> statement-breakpoint
-- Aşama geçmişi değişmez ve silinmez (DOM-FIN-128, K-440): ortak `kampus_reject_immutable_change()` (migration 0013, 55000).
CREATE TRIGGER "job_application_stage_changes_immutable_trigger" BEFORE UPDATE OR DELETE ON "job_application_stage_changes" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "job_application_stage_changes_truncate_trigger" BEFORE TRUNCATE ON "job_application_stage_changes" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TABLE "job_postings" IS 'İş ilanı (DOM-FIN-128, ON-177, K-439): başlık, pozisyon/branş, çalışma türü, açıklama, nitelikler, yayın ve son başvuru günü. Durum taslak → yayında → kapandı; taslak doğrudan kapanabilir, kapanan ilan değişmez ve yeniden açılmaz. İlan silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."id" IS 'İlan kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."title" IS 'İlan başlığı (2–160 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."position" IS 'Pozisyon ya da branş (2–120 karakter, serbest metin; ör. İngilizce öğretmeni).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."employment_type" IS 'Çalışma türü: full_time tam zamanlı, part_time yarı zamanlı, extra_lessons ek ders.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."description" IS 'İş tanımı (10–4000 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."requirements" IS 'Aranan nitelikler (≤ 4000 karakter, isteğe bağlı).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."publish_on" IS 'Yayın günü; ilan yayımlandıktan sonra değişmez. Başvuru günü bundan önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."deadline_on" IS 'Son başvuru günü; yayın gününden önce ve alınmış başvuruların gününden önce olamaz. Geçmişse ilan yayımlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."status" IS 'Durum: draft taslak, published yayında, closed kapandı. Taslağa başvuru kaydedilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."closed_on" IS 'Kapanış günü (Europe/Istanbul); yalnız kapanan ilanda dolu. İşe alınmamış ve reddedilmemiş başvuruların saklama süresi bu günden başlar (K-441).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."created_by_user_id" IS 'İlanı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); ilan silinmez, kapatılır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_postings"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "job_applications" IS 'İş başvurusu (DOM-FIN-128, ON-177, K-440, K-441): ilana bağlı aday başvurusu; personel girer (kurum sitesi, e-posta, elden, tavsiye). Aday aydınlatma metninin gösterilen sürümü ve günü zorunludur. Saklama süresi dolunca ya da adayın talebiyle anonimleştirilir (ad sabit metne, iletişim, not ve özgeçmiş bağı boşa; dosya imhaya işaretlenir); satır silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."id" IS 'Başvuru kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."job_posting_id" IS 'Başvurulan ilan (job_postings); taslak olamaz. Restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."candidate_name" IS 'Adayın adı soyadı (kişisel veri, 2–120); anonimleştirmede "Anonim aday".';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."email" IS 'Adayın e-postası (kişisel veri, küçük harf); aynı ilanda tekil. Anonimleştirmede boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."phone" IS 'Adayın telefonu (kişisel veri, 0XXXXXXXXXX); aynı ilanda tekil. E-posta ya da telefondan biri zorunlu; anonimleştirmede boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."channel" IS 'Başvuru kanalı: website kurum sitesi, email e-posta, in_person elden, referral tavsiye.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."received_on" IS 'Başvurunun alındığı gün; ilanın yayın ve son başvuru günleri arasında, kayıt gününden sonra değil.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."cv_file_id" IS 'Özgeçmiş (files; amaç document, bağ türü job_application, PDF); isteğe bağlı. Anonimleştirmede dosya imhaya işaretlenir ve bağ boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."privacy_notice_version" IS 'Adaya gösterilen aday aydınlatma metninin sürümü (KVKK md. 10; 1–40 karakter); zorunlu, anonimleştirmede kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."privacy_notice_shown_on" IS 'Aydınlatma metninin adaya gösterildiği gün; zorunlu, kayıt gününden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."note" IS 'İç not (kişisel veri olabilir, ≤ 1000); denetime yazılmaz, anonimleştirmede boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."stage" IS 'Aşama: new yeni, screening ön eleme, interview mülakat, offer teklif, hired işe alındı, rejected reddedildi. Yalnız ileri ya da reddedildi; hired ve rejected sondur.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."stage_changed_on" IS 'Son aşama değişikliğinin günü (ilk değer başvuru günü); reddedilen başvuruda saklama süresi bu günden başlar.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."anonymized_at" IS 'Anonimleştirildiği an (UTC); doluysa başvuru değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."anonymization_reason" IS 'Anonimleştirme gerekçesi: retention_expired saklama süresi doldu, data_subject_request adayın silme talebi.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."recorded_by_user_id" IS 'Başvuruyu giren personel (yönetici ya da ön büro).';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."created_at" IS 'Kaydın girildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); başvuru silinmez, anonimleştirilir.';
--> statement-breakpoint
COMMENT ON COLUMN "job_applications"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "job_application_stage_changes" IS 'Başvuru aşama geçmişi (DOM-FIN-128, ON-177, K-440): ilk satır kayıt (önceki boş, new), sonra her aşama değişikliği. Aday verisi taşımaz; değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."id" IS 'Geçmiş satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."job_application_id" IS 'Başvuru (job_applications). Restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."from_stage" IS 'Önceki aşama; ilk satırda boş.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."to_stage" IS 'Yeni aşama.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."changed_on" IS 'Aşamanın değiştiği gün; önceki aşama gününden önce ve kayıt gününden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."changed_by_user_id" IS 'Aşamayı değiştiren kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."created_at" IS 'Kayıt anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."updated_at" IS 'Kayıt anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); satır silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_stage_changes"."version" IS 'Sürüm; satır değişmediğinden 1 kalır.';
--> statement-breakpoint
COMMENT ON TABLE "job_application_settings" IS 'Başvuru havuzu kurum ayarı (DOM-FIN-128, ON-177, K-441): saklama süresi ve geçerli aday aydınlatma metni sürümü. Kurum başına bir satır; yoksa varsayılan (12 ay).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."institution_id" IS 'Kurum (birincil anahtar).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."retention_months" IS 'Reddedilen ve kapanan ilandaki işe alınmamış başvuruların saklama süresi (ay, 1–60; varsayılan 12). Süre ve dayanağı doğrulanmalı (H-96).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."privacy_notice_version" IS 'Geçerli aday aydınlatma metninin sürümü (≤ 40); başvuru formunda önerilir, boş olabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."created_at" IS 'Ayarın ilk kaydedildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."archived_at" IS 'Kullanılmıyor (zorunlu kolon).';
--> statement-breakpoint
COMMENT ON COLUMN "job_application_settings"."version" IS 'İyimser kilit sürümü (If-Match); satır yoksa 1 sayılır, ilk kayıt 2 ile açılır.';
