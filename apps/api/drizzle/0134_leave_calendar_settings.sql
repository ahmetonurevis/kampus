CREATE TABLE "leave_calendar_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"concurrent_threshold" integer DEFAULT 2 NOT NULL,
	"exam_weeks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_calendar_settings_threshold_check" CHECK ("leave_calendar_settings"."concurrent_threshold" between 2 and 20),
	CONSTRAINT "leave_calendar_settings_exam_weeks_check" CHECK (jsonb_typeof("leave_calendar_settings"."exam_weeks") = 'array' and jsonb_array_length("leave_calendar_settings"."exam_weeks") <= 40)
);
--> statement-breakpoint
ALTER TABLE "leave_calendar_settings" ADD CONSTRAINT "leave_calendar_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
COMMENT ON TABLE "leave_calendar_settings" IS 'İzin takvimi ayarı (DOM-FIN-123, ON-183, K-421, K-422). Kurum başına bir satır; satır yoksa varsayılan geçerlidir (eşik 2, sınav haftası yok). Uyarılar engel değildir. Yalnız yönetici yazar; If-Match sürümle.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."institution_id" IS 'Kurum (birincil anahtar; kurum başına tek ayar).';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."concurrent_threshold" IS 'Aynı branşta (öğretmen kaydının dersi) aynı gün izinli farklı personel sayısı bu sayıya ulaşınca uyarı; 2–20, varsayılan 2. Bekleyen talepler de sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."exam_weeks" IS 'Sınav haftaları: [{label, startDate, endDate}] dizisi (gün YYYY-MM-DD, uçlar dahil, en çok 31 gün); en çok 40, birbiriyle çakışmaz, başlangıca göre sıralı. Yazmadan önce core leaveCalendarSettingsSchema ile doğrulanır; denk gelen izin uyarı alır.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."created_at" IS 'Ayarın ilk kaydı.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."updated_at" IS 'Son değişiklik.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."archived_at" IS 'Kullanılmaz (ayar silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "leave_calendar_settings"."version" IS 'Ayar sürümü (If-Match); satır yokken 1, ilk kayıt 2.';
