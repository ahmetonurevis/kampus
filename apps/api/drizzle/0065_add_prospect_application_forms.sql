CREATE TABLE "prospect_application_forms" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"form_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"site_origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "prospect_application_forms_form_key_check" CHECK ("prospect_application_forms"."form_key" ~ '^[A-Za-z0-9_-]{32}$'),
	CONSTRAINT "prospect_application_forms_site_origin_check" CHECK ("prospect_application_forms"."site_origin" is null or "prospect_application_forms"."site_origin" ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$')
);
--> statement-breakpoint
ALTER TABLE "prospect_application_forms" ADD CONSTRAINT "prospect_application_forms_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_application_forms_form_key_key" ON "prospect_application_forms" USING btree ("form_key");
--> statement-breakpoint
-- Elle eklendi (ON-133): tablo ve kolon açıklamaları; birleştirmede migration yeniden üretilirse bu blok korunur.
COMMENT ON TABLE "prospect_application_forms" IS 'Kurum sitesine gömülen ön başvuru formu (ON-133; DOM-KAY-003, -009; IST-145). Kurum başına tek satır, kişisel veri taşımaz. Kayıt alanıdır, modül ayarı değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."institution_id" IS 'Formun kurumu; kurum başına tek satır.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."form_key" IS 'Adreste taşınan rastgele anahtar (24 bayt, base64url). Açık uçta kurumu bu çözer; yenilenince eskisi hemen geçersizdir.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."enabled" IS 'Yöneticinin form açık/kapalı kararı. Kapalı form açık uçta geçersiz anahtarla aynı 404 döner.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."site_origin" IS 'Formun gömülebileceği kurum sitesinin https kök adresi (frame-ancestors değeri). Boşsa form gömülemez, yalnız doğrudan bağlantıyla açılır.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."created_at" IS 'Satırın açıldığı an.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."updated_at" IS 'Son ayar ya da anahtar değişikliği anı.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."archived_at" IS 'Arşiv anı; dolu satır yok sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "prospect_application_forms"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON INDEX "prospect_application_forms_form_key_key" IS 'Kurumsuz tekillik, belgelenmiş istisna: oturumsuz uçta kurum bu anahtardan çözülür.';
