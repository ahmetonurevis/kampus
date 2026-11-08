CREATE TABLE "fixed_assets" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"tag_number" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"campus_id" text,
	"location" text NOT NULL,
	"acquisition_value_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"acquisition_date" date NOT NULL,
	"supplier_id" uuid,
	"receipt_item_id" uuid,
	"status" text DEFAULT 'in_use' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"scrapped_at" timestamp with time zone,
	"scrap_date" date,
	"scrapped_by_user_id" text,
	"scrap_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixed_assets_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "fixed_assets_tag_number_check" CHECK ("fixed_assets"."tag_number" ~ '^[A-Z0-9][A-Z0-9./-]{1,39}$'),
	CONSTRAINT "fixed_assets_text_check" CHECK (char_length("fixed_assets"."name") between 2 and 200
        and char_length("fixed_assets"."location") between 2 and 120
        and ("fixed_assets"."scrap_reason" is null or char_length("fixed_assets"."scrap_reason") <= 500)),
	CONSTRAINT "fixed_assets_category_check" CHECK ("fixed_assets"."category" in ('furniture', 'it', 'audiovisual', 'office', 'laboratory', 'sports', 'kitchen', 'appliance', 'vehicle', 'other')),
	CONSTRAINT "fixed_assets_status_check" CHECK ("fixed_assets"."status" in ('in_use', 'in_storage', 'broken', 'scrapped')),
	CONSTRAINT "fixed_assets_value_check" CHECK ("fixed_assets"."acquisition_value_cents" between 1 and 10000000000),
	CONSTRAINT "fixed_assets_currency_check" CHECK ("fixed_assets"."currency" = 'TRY'),
	CONSTRAINT "fixed_assets_scrap_check" CHECK ((("fixed_assets"."status" = 'scrapped') = ("fixed_assets"."scrapped_at" is not null))
        and (("fixed_assets"."scrapped_at" is null) = ("fixed_assets"."scrap_date" is null))
        and (("fixed_assets"."scrapped_at" is null) = ("fixed_assets"."scrapped_by_user_id" is null))
        and (("fixed_assets"."scrapped_at" is null) = ("fixed_assets"."scrap_reason" is null))
        and ("fixed_assets"."scrap_date" is null or "fixed_assets"."scrap_date" >= "fixed_assets"."acquisition_date"))
);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_receipt_item_fkey" FOREIGN KEY ("institution_id","receipt_item_id") REFERENCES "public"."purchase_receipt_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_tag_number_key" ON "fixed_assets" USING btree ("institution_id","tag_number") WHERE "fixed_assets"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "fixed_assets_campus_idx" ON "fixed_assets" USING btree ("institution_id","campus_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_supplier_idx" ON "fixed_assets" USING btree ("institution_id","supplier_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_receipt_item_idx" ON "fixed_assets" USING btree ("institution_id","receipt_item_id");--> statement-breakpoint
COMMENT ON TABLE "fixed_assets" IS 'Demirbaş (DOM-FIN-085, ON-235): kurumun kalıcı kullanımdaki tek varlığı. Etiket numarası kurumda tekildir; boş bırakılırsa DB-<yıl>-<sıra> verilir, elle de girilir (K-185). Silinmez; hurdaya ayırma gerekçe ve gün ister, geri alınmaz (K-188). Zimmet (ON-236), sayım (ON-237) ve amortisman (ON-238) ayrı kayıtlardır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."id" IS 'Demirbaş kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."tag_number" IS 'Etiket numarası: büyük harf, rakam, nokta, tire ve eğik çizgi, 2–40 karakter; kurumda arşivlenmemiş kayıtlar arasında tekil (fixed_assets_tag_number_key). Önerilen biçim DB-<kayıt yılı>-<sıra> (K-185).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."name" IS 'Demirbaşın adı, 2–200 karakter (ör. Akıllı tahta).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."category" IS 'Sabit kategori kümesi (K-186): furniture mobilya, it bilgisayar ve bilişim, audiovisual görsel-işitsel cihaz, office büro makinesi, laboratory laboratuvar ve eğitim donanımı, sports spor malzemesi, kitchen mutfak ve yemekhane, appliance klima ve elektrikli cihaz, vehicle taşıt, other diğer.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."campus_id" IS 'Kampüs: records tablosundaki branches kaydının kimliği; tek kampüslü kurumda boş. Yabancı anahtar yoktur, varlık kayıtta ve kampüs değişince sunucuda denetlenir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."location" IS 'Kampüs içindeki oda ya da yer, serbest metin, 2–120 karakter (ör. 2. kat fen laboratuvarı).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."acquisition_value_cents" IS 'Alım değeri, KDV hariç, kuruş; 1 kuruş ile 100 milyon TL arası. KDV ve bağış değerlemesi mali müşavire sorulacak (M-30).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."currency" IS 'Para birimi; bugün yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."acquisition_date" IS 'Alım günü (Europe/Istanbul); bugünden sonra olamaz, mal kabule bağlıysa kabul gününden önce olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."supplier_id" IS 'İsteğe bağlı tedarikçi (suppliers, DOM-FIN-070); mal kabule bağlıysa siparişin tedarikçisidir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."receipt_item_id" IS 'İsteğe bağlı mal kabul kalemi (purchase_receipt_items, DOM-FIN-074). Kaleme bağlı demirbaş sayısı kalemde kabul edilen miktarı aşamaz; her demirbaş bir adettir (K-187).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."status" IS 'Durum: in_use kullanımda, in_storage depoda, broken arızalı, scrapped hurdaya ayrıldı. İlk üçü arasında serbest geçilir; scrapped yalnız hurdaya ayırma komutuyla olur ve geri alınmaz (K-188).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."created_by_user_id" IS 'Kaydı açan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."scrapped_at" IS 'Hurdaya ayırma işleminin zamanı (UTC); durum scrapped iken dolu, değilse boş.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."scrap_date" IS 'Hurdaya ayırma günü (Europe/Istanbul); alım gününden önce ve işlem gününden sonra olamaz.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."scrapped_by_user_id" IS 'Hurdaya ayıran yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."scrap_reason" IS 'Hurdaya ayırma gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."archived_at" IS 'Arşiv zamanı; demirbaş arşivlenmez, hurdaya ayrılır. Etiket tekilliği arşivlenmemiş kayıtlar arasındadır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_assets"."version" IS 'İyimser kilit sürümü (If-Match; düzeltme ve hurdaya ayırma).';
