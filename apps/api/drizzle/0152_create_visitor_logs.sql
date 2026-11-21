CREATE TABLE "visitor_logs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"visitor_name" text NOT NULL,
	"identity_verified" boolean NOT NULL,
	"identity_document_type" text,
	"phone" text,
	"purpose" text NOT NULL,
	"purpose_note" text,
	"host_membership_id" text,
	"student_id" text,
	"visit_on" date NOT NULL,
	"checked_in_at" timestamp with time zone NOT NULL,
	"checked_out_at" timestamp with time zone,
	"badge_number" text,
	"badge_released_at" timestamp with time zone,
	"badge_release" text,
	"privacy_notice_version" text NOT NULL,
	"anonymized_at" timestamp with time zone,
	"anonymization_reason" text,
	"checked_in_by_user_id" text NOT NULL,
	"checked_out_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "visitor_logs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "visitor_logs_purpose_check" CHECK ("visitor_logs"."purpose" in ('parent_meeting', 'supplier', 'official', 'job_applicant', 'other')),
	CONSTRAINT "visitor_logs_identity_check" CHECK (("visitor_logs"."identity_verified" and "visitor_logs"."identity_document_type" is not null and "visitor_logs"."identity_document_type" in ('national_id', 'driver_license', 'passport', 'other')) or (not "visitor_logs"."identity_verified" and "visitor_logs"."identity_document_type" is null)),
	CONSTRAINT "visitor_logs_name_check" CHECK (char_length("visitor_logs"."visitor_name") between 2 and 120),
	CONSTRAINT "visitor_logs_phone_check" CHECK ("visitor_logs"."phone" is null or "visitor_logs"."phone" ~ '^0[0-9]{10}$'),
	CONSTRAINT "visitor_logs_purpose_note_check" CHECK (("visitor_logs"."purpose_note" is null or char_length("visitor_logs"."purpose_note") between 1 and 200) and ("visitor_logs"."purpose" <> 'other' or "visitor_logs"."purpose_note" is not null or "visitor_logs"."anonymized_at" is not null)),
	CONSTRAINT "visitor_logs_student_check" CHECK ("visitor_logs"."student_id" is null or "visitor_logs"."purpose" = 'parent_meeting'),
	CONSTRAINT "visitor_logs_badge_check" CHECK ("visitor_logs"."badge_number" is null or "visitor_logs"."badge_number" ~ '^[A-Z0-9-]{1,20}$'),
	CONSTRAINT "visitor_logs_badge_release_check" CHECK (("visitor_logs"."badge_released_at" is null) = ("visitor_logs"."badge_release" is null) and ("visitor_logs"."badge_release" is null or ("visitor_logs"."badge_number" is not null and "visitor_logs"."badge_release" in ('returned', 'lost')))),
	CONSTRAINT "visitor_logs_check_out_check" CHECK ("visitor_logs"."checked_out_at" is null or "visitor_logs"."checked_out_at" >= "visitor_logs"."checked_in_at"),
	CONSTRAINT "visitor_logs_checked_out_by_check" CHECK (("visitor_logs"."checked_out_at" is null) = ("visitor_logs"."checked_out_by_user_id" is null)),
	CONSTRAINT "visitor_logs_notice_check" CHECK (char_length("visitor_logs"."privacy_notice_version") between 1 and 40),
	CONSTRAINT "visitor_logs_anonymized_check" CHECK (("visitor_logs"."anonymized_at" is null) = ("visitor_logs"."anonymization_reason" is null) and ("visitor_logs"."anonymization_reason" is null or "visitor_logs"."anonymization_reason" in ('retention_expired', 'data_subject_request')) and ("visitor_logs"."anonymized_at" is null or ("visitor_logs"."checked_out_at" is not null and "visitor_logs"."phone" is null and "visitor_logs"."purpose_note" is null and "visitor_logs"."student_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "visitor_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"privacy_notice_version" text,
	"badge_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "visitor_settings_retention_check" CHECK ("visitor_settings"."retention_days" between 1 and 365),
	CONSTRAINT "visitor_settings_notice_check" CHECK ("visitor_settings"."privacy_notice_version" is null or char_length("visitor_settings"."privacy_notice_version") between 1 and 40),
	CONSTRAINT "visitor_settings_badges_check" CHECK (jsonb_typeof("visitor_settings"."badge_numbers") = 'array')
);
--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_host_membership_fkey" FOREIGN KEY ("institution_id","host_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_settings" ADD CONSTRAINT "visitor_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitor_logs_visit_on_idx" ON "visitor_logs" USING btree ("institution_id","visit_on");--> statement-breakpoint
CREATE INDEX "visitor_logs_inside_idx" ON "visitor_logs" USING btree ("institution_id","checked_in_at") WHERE "visitor_logs"."checked_out_at" is null;--> statement-breakpoint
CREATE INDEX "visitor_logs_host_idx" ON "visitor_logs" USING btree ("institution_id","host_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_logs_badge_outstanding_key" ON "visitor_logs" USING btree ("institution_id","badge_number") WHERE "visitor_logs"."badge_number" is not null and "visitor_logs"."badge_released_at" is null;--> statement-breakpoint
COMMENT ON TABLE "visitor_logs" IS 'Ziyaretçi kaydı (DOM-FIN-141, ON-166, K-478…K-480): giriş, çıkış, kart ve aydınlatma kaydı. Kimlik numarası saklanmaz. Kayıt ziyaret gününden kurum ayarlı süre (varsayılan 30 gün) sonra yöneticinin komutuyla anonimleştirilir; satır silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."id" IS 'Ziyaret kaydı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."visitor_name" IS 'Ziyaretçinin adı soyadı (2–120; kişisel veri). Anonimleştirmede ''Anonim ziyaretçi'' olur.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."identity_verified" IS 'Kimlik belgesi görüldü mü (K-478). Belge numarası hiçbir yerde saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."identity_document_type" IS 'Görülen belgenin türü: national_id, driver_license, passport, other; yalnız kimlik görüldüyse dolu ve o zaman zorunlu.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."phone" IS 'Ziyaretçinin telefonu (isteğe bağlı, 0XXXXXXXXXX; kişisel veri). Listede yalnız maskeli döner; anonimleştirmede silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."purpose" IS 'Ziyaret amacı: parent_meeting veli görüşmesi, supplier tedarikçi, official resmî, job_applicant iş başvurusu, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."purpose_note" IS 'Amaç açıklaması (≤ 200, serbest metin); other amacında zorunlu. Denetime ve loga yazılmaz; anonimleştirmede silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."host_membership_id" IS 'Ziyaret edilen personelin kurum üyeliği (isteğe bağlı; memberships FK, girişte etkin personel olmalı).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."student_id" IS 'Veli görüşmesinde görüşülen öğrencinin records kimliği (isteğe bağlı, yalnız parent_meeting); anonimleştirmede silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."visit_on" IS 'Ziyaret günü: girişin Europe/Istanbul günü. Gün süzgeci ve saklama süresinin başlangıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."checked_in_at" IS 'Giriş anı (UTC); kayıt anından en çok 24 saat önce olabilir, gelecekte olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."checked_out_at" IS 'Çıkış anı (UTC); boşsa ziyaretçi içeride. Girişten önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."badge_number" IS 'Verilen ziyaretçi kartı numarası (kurum havuzundan, isteğe bağlı). İade ya da kayıp işaretlenene kadar kartın tek açık kaydı olur (visitor_logs_badge_outstanding_key).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."badge_released_at" IS 'Kartın iade edildiği ya da kayıp işaretlendiği an; boşsa kart ziyaretçide.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."badge_release" IS 'Kartın kapanışı: returned iade edildi, lost kayıp.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."privacy_notice_version" IS 'Ziyaretçiye gösterilen aydınlatma metninin sürümü (zorunlu; gösterildi işareti).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."anonymized_at" IS 'Anonimleştirme anı; doluysa kişisel alanlar temizlenmiştir ve kayıt değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."anonymization_reason" IS 'Anonimleştirme gerekçesi: retention_expired saklama süresi doldu, data_subject_request ziyaretçinin silme talebi.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."checked_in_by_user_id" IS 'Girişi kaydeden kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."checked_out_by_user_id" IS 'Çıkışı kaydeden kullanıcı; çıkış yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); kayıt arşivlenmez, anonimleştirilir.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_logs"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "visitor_settings" IS 'Ziyaretçi kaydı ayarı (DOM-FIN-141, K-479, K-480): kurum başına saklama süresi, geçerli aydınlatma sürümü ve kart havuzu. Satır yoksa varsayılan (30 gün, sürüm boş, havuz boş).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."institution_id" IS 'Kurum (birincil anahtar).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."retention_days" IS 'Ziyaret kaydının saklama süresi (gün, 1–365; varsayılan 30). Süre ziyaret gününden sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."privacy_notice_version" IS 'Geçerli ziyaretçi aydınlatma metni sürümü; giriş formunda önerilir.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."badge_numbers" IS 'Kurumun ziyaretçi kartı havuzu (JSON dizi, en çok 200 numara; harf, rakam, tire). İade edilmemiş kart havuzdan çıkarılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."archived_at" IS 'Kullanılmıyor (zorunlu kolon).';
--> statement-breakpoint
COMMENT ON COLUMN "visitor_settings"."version" IS 'İyimser kilit sürümü (If-Match); satır yoksa 1 sayılır, ilk kayıt 2 ile açılır.';
