CREATE TABLE "staff_medical_reports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"report_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"day_count" integer NOT NULL,
	"issuer_type" text,
	"file_id" uuid,
	"employer_notified_at" timestamp with time zone,
	"employer_notified_by_user_id" text,
	"sgk_approved_at" timestamp with time zone,
	"sgk_approved_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_medical_reports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_medical_reports_type_check" CHECK ("staff_medical_reports"."report_type" in ('sickness', 'work_accident', 'occupational_disease', 'maternity')),
	CONSTRAINT "staff_medical_reports_issuer_check" CHECK ("staff_medical_reports"."issuer_type" is null or "staff_medical_reports"."issuer_type" in ('public', 'private', 'family_physician')),
	CONSTRAINT "staff_medical_reports_dates_check" CHECK ("staff_medical_reports"."end_date" >= "staff_medical_reports"."start_date"
        and "staff_medical_reports"."day_count" = ("staff_medical_reports"."end_date" - "staff_medical_reports"."start_date") + 1
        and "staff_medical_reports"."day_count" <= 366),
	CONSTRAINT "staff_medical_reports_flags_check" CHECK ((("staff_medical_reports"."employer_notified_at" is null) = ("staff_medical_reports"."employer_notified_by_user_id" is null))
        and (("staff_medical_reports"."sgk_approved_at" is null) = ("staff_medical_reports"."sgk_approved_by_user_id" is null))
        and ("staff_medical_reports"."sgk_approved_at" is null or "staff_medical_reports"."employer_notified_at" is not null)),
	CONSTRAINT "staff_medical_reports_cancel_check" CHECK ((("staff_medical_reports"."archived_at" is null) = ("staff_medical_reports"."cancel_reason" is null))
        and (("staff_medical_reports"."archived_at" is null) = ("staff_medical_reports"."cancelled_by_user_id" is null))
        and ("staff_medical_reports"."archived_at" is null or "staff_medical_reports"."file_id" is null)
        and ("staff_medical_reports"."cancel_reason" is null or char_length("staff_medical_reports"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_medical_reports" ADD CONSTRAINT "staff_medical_reports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_medical_reports" ADD CONSTRAINT "staff_medical_reports_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_medical_reports" ADD CONSTRAINT "staff_medical_reports_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_medical_reports_membership_idx" ON "staff_medical_reports" USING btree ("institution_id","membership_id","start_date");--> statement-breakpoint
CREATE INDEX "staff_medical_reports_period_idx" ON "staff_medical_reports" USING btree ("institution_id","start_date","end_date") WHERE "staff_medical_reports"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_medical_reports_file_idx" ON "staff_medical_reports" USING btree ("institution_id","file_id") WHERE "staff_medical_reports"."file_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "staff_medical_reports" IS 'Personel sağlık raporu (DOM-FIN-110, ON-185, K-363…K-365): bir personel üyeliğine istirahat raporunun yalnız tarih aralığı ve sigorta türü (hastalık, iş kazası, meslek hastalığı, analık). Sağlık verisi özel niteliklidir: tanı, hastalık adı, ICD kodu ve serbest not tutulmaz. Aynı personelin iptal edilmemiş raporları çakışmaz (kurum kilidi altında servis denetimi). Rapor düzeltilmez: yalnız SGK işaretleri ve dosya değişir, yanlış kayıt gerekçeyle iptal (arşiv) edilir. SGK bildirimi ve rapor parası hesaplanmaz. Yalnız yönetici okur ve yazar; okuma, yazma ve dosya açılışı denetim kaydına yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."id" IS 'Rapor kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."membership_id" IS 'Raporun ait olduğu personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse geçmiş korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."report_type" IS 'Sigorta türü (tanı değil): sickness istirahat (hastalık), work_accident iş kazası, occupational_disease meslek hastalığı, maternity analık. Özel nitelikli veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."start_date" IS 'Rapor başlangıcı (gün, dahil). Bugünden en çok 180 gün ileride; pasif personelde ayrıldığı günden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."end_date" IS 'Rapor bitişi (gün, dahil); başlangıçtan önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."day_count" IS 'Takvim günü sayısı, uçlar dahil (end_date - start_date + 1, en çok 366). Aralıktan türetilir; kısıtla denetlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."issuer_type" IS 'İsteğe bağlı veren kurum türü: public devlet, private özel sağlık kuruluşu, family_physician aile hekimi.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."file_id" IS 'İsteğe bağlı rapor dosyası (files, amaç document, bağ türü staff_medical_report). Yalnız yönetici açar, her açılış denetim kaydına yazılır. İptal edilen raporda boştur (bağ kalkar, dosya bağsız dosya temizliğiyle silinir).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."employer_notified_at" IS 'Raporun işverene bildirildiği işaretlendiği an; işaret geri alınınca boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."employer_notified_by_user_id" IS '"İşverene bildirildi" işaretini koyan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."sgk_approved_at" IS 'İşverenin raporu SGK sisteminde onayladığının (çalışmadığına dair bildirim) işaretlendiği an; işverene bildirim işaretini ister.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."sgk_approved_by_user_id" IS '"SGK sisteminde onaylandı" işaretini koyan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."created_by_user_id" IS 'Raporu yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter; tanı yazılmaz); yalnız iptal edilmiş (arşivli) raporda. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."cancelled_by_user_id" IS 'Raporu iptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."archived_at" IS 'İptal anı; iptal edilen rapor gün hesabına ve çakışma denetimine girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_medical_reports"."version" IS 'İyimser kilit sürümü (If-Match).';
