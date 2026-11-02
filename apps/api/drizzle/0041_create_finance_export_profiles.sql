-- Muhasebe aktarım profili (ON-024, IST-111).
CREATE TABLE "finance_export_profiles" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_export_profiles" ADD CONSTRAINT "finance_export_profiles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "finance_export_profiles" IS 'Kurumun muhasebe aktarım dosyası biçimi; yalnız biçimdir, satır ve toplam değiştirmez. Satır yoksa standart dosya iner.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."institution_id" IS 'Kurum; kurum başına tek profil.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."profile" IS 'Sütun adı, sırası, ayırıcı, tarih ve tutar biçimi, sabit hesap kodları (core şemasıyla doğrulanır); boşsa standart dosya.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."created_at" IS 'Oluşturma anı.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."archived_at" IS 'Arşiv anı; arşivli profil okunmaz.';--> statement-breakpoint
COMMENT ON COLUMN "finance_export_profiles"."version" IS 'İyimser kilit sürümü.';
