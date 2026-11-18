CREATE TABLE "sgk_employment_dates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"month" date NOT NULL,
	"entry_date" date,
	"exit_date" date,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sgk_employment_dates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "sgk_employment_dates_month_check" CHECK (extract(day from "sgk_employment_dates"."month") = 1),
	CONSTRAINT "sgk_employment_dates_days_check" CHECK (("sgk_employment_dates"."entry_date" is not null or "sgk_employment_dates"."exit_date" is not null)
        and ("sgk_employment_dates"."entry_date" is null or date_trunc('month', "sgk_employment_dates"."entry_date")::date = "sgk_employment_dates"."month")
        and ("sgk_employment_dates"."exit_date" is null or date_trunc('month', "sgk_employment_dates"."exit_date")::date = "sgk_employment_dates"."month")
        and ("sgk_employment_dates"."entry_date" is null or "sgk_employment_dates"."exit_date" is null or "sgk_employment_dates"."exit_date" >= "sgk_employment_dates"."entry_date")),
	CONSTRAINT "sgk_employment_dates_note_check" CHECK ("sgk_employment_dates"."note" is null or char_length("sgk_employment_dates"."note") between 1 and 200),
	CONSTRAINT "sgk_employment_dates_archive_check" CHECK (("sgk_employment_dates"."archived_at" is null) = ("sgk_employment_dates"."archived_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "sgk_missing_days" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"month" date NOT NULL,
	"days" integer NOT NULL,
	"reason_code" text,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sgk_missing_days_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "sgk_missing_days_month_check" CHECK (extract(day from "sgk_missing_days"."month") = 1),
	CONSTRAINT "sgk_missing_days_days_check" CHECK ("sgk_missing_days"."days" between 1 and 30),
	CONSTRAINT "sgk_missing_days_reason_check" CHECK ("sgk_missing_days"."reason_code" is null or "sgk_missing_days"."reason_code" in ('01', '03', '04', '05', '06', '07', '08', '09', '10', '11', '13', '15', '16', '18', '19', '20', '21', '23', '25')),
	CONSTRAINT "sgk_missing_days_note_check" CHECK ("sgk_missing_days"."note" is null or char_length("sgk_missing_days"."note") between 1 and 200),
	CONSTRAINT "sgk_missing_days_archive_check" CHECK (("sgk_missing_days"."archived_at" is null) = ("sgk_missing_days"."archived_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "sgk_employment_dates" ADD CONSTRAINT "sgk_employment_dates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sgk_employment_dates" ADD CONSTRAINT "sgk_employment_dates_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sgk_missing_days" ADD CONSTRAINT "sgk_missing_days_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sgk_missing_days" ADD CONSTRAINT "sgk_missing_days_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sgk_employment_dates_member_month_key" ON "sgk_employment_dates" USING btree ("institution_id","membership_id","month") WHERE "sgk_employment_dates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "sgk_employment_dates_membership_idx" ON "sgk_employment_dates" USING btree ("institution_id","membership_id","month");--> statement-breakpoint
CREATE INDEX "sgk_employment_dates_month_idx" ON "sgk_employment_dates" USING btree ("institution_id","month");--> statement-breakpoint
CREATE INDEX "sgk_missing_days_month_idx" ON "sgk_missing_days" USING btree ("institution_id","month","membership_id");--> statement-breakpoint
CREATE INDEX "sgk_missing_days_membership_idx" ON "sgk_missing_days" USING btree ("institution_id","membership_id","month");--> statement-breakpoint
COMMENT ON TABLE "sgk_missing_days" IS 'SGK bildirge hazırlık listesinin elle girilen eksik gün satırı (DOM-FIN-107, ON-203, K-353): personel üyeliği ve ay başına birden çok satır; ayın toplamı 30 günü aşamaz (kurum kilidi altında servis denetimi). Prim günü 30 (ya da ay içi giriş/çıkışta takvim günü) eksi eksik gündür. Liste resmî bildirge değildir, hiçbir resmî sisteme gönderilmez (IST-143). Satır düzeltilmez, kaldırılır (arşiv). Yalnız yönetici okur ve yazar (K-355).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."id" IS 'Satır kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."membership_id" IS 'Eksik günü olan personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse satır korunur: restrict.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."month" IS 'Satırın ayı: ayın ilk günü (gün 1 denetimi).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."days" IS 'Eksik gün sayısı (1–30); ayın satırları toplamı 30 günü aşamaz.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."reason_code" IS 'Muhtasar ve Prim Hizmet Beyannamesi eksik gün nedeni kodu (01 istirahat, 21 diğer ücretsiz izin…; liste doğrulanmalı, M-63). Boşsa listede "neden girilmemiş" uyarısı çıkar. Birleşik kodlar (12, 24, 27) saklanmaz, ayın satırlarından hesaplanır. 01 sağlık raporuna işaret eder; tanı tutulmaz (H-65).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."note" IS 'İsteğe bağlı not (1–200 karakter); tanı yazılmaz, denetim kaydına yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."created_by_user_id" IS 'Satırı giren yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."archived_by_user_id" IS 'Satırı kaldıran yönetici; yalnız arşivli satırda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."created_at" IS 'Kaydın açıldığı an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."archived_at" IS 'Kaldırılma anı; arşivli satır listeye ve ay toplamına girmez.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_missing_days"."version" IS 'İyimser kilit sürümü (If-Match ile kaldırma).';--> statement-breakpoint
COMMENT ON TABLE "sgk_employment_dates" IS 'SGK bildirge hazırlık listesinin elle girilen işe giriş/çıkış günü (DOM-FIN-107, ON-203, K-352): ücret tanımı zincirinden çıkan günün yerine geçer. Üyelik ve ay başına tek etkin satır; günler ayın içinde, çıkış girişten önce değil. Resmî işe giriş/ayrılış bildirgesi değildir (H-66). Satır düzeltilmez, kaldırılır (arşiv). Yalnız yönetici okur ve yazar (K-355).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."id" IS 'Satır kimliği (UUID).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."membership_id" IS 'Personelin kurum üyeliği (memberships). Üyelik silinirse satır korunur: restrict.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."month" IS 'Satırın ayı: ayın ilk günü (gün 1 denetimi).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."entry_date" IS 'Ay içindeki işe giriş günü; boşsa giriş ücret tanımından çıkar.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."exit_date" IS 'Ay içindeki işten çıkış günü; boşsa çıkış ücret tanımından çıkar. Giriş ve çıkıştan en az biri doludur.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."note" IS 'İsteğe bağlı not (1–200 karakter); denetim kaydına yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."created_by_user_id" IS 'Satırı giren yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."archived_by_user_id" IS 'Satırı kaldıran yönetici; yalnız arşivli satırda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."created_at" IS 'Kaydın açıldığı an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."archived_at" IS 'Kaldırılma anı; arşivli satır listeye girmez ve aynı ay için yeni satıra yer açar.';--> statement-breakpoint
COMMENT ON COLUMN "sgk_employment_dates"."version" IS 'İyimser kilit sürümü (If-Match ile kaldırma).';
