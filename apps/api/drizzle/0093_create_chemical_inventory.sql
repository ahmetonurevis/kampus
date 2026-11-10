CREATE TABLE "stock_chemical_profiles" (
	"institution_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"hazard_pictograms" text[] DEFAULT '{}'::text[] NOT NULL,
	"signal_word" text,
	"cas_number" text,
	"storage_class" text,
	"incompatibility_note" text,
	"sds_url" text,
	"sds_document_number" text,
	"sds_revision_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_chemical_profiles_pkey" PRIMARY KEY("institution_id","item_id"),
	CONSTRAINT "stock_chemical_profiles_pictograms_check" CHECK ("stock_chemical_profiles"."hazard_pictograms" <@ array['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09']::text[]),
	CONSTRAINT "stock_chemical_profiles_signal_word_check" CHECK ("stock_chemical_profiles"."signal_word" is null or "stock_chemical_profiles"."signal_word" in ('danger', 'warning')),
	CONSTRAINT "stock_chemical_profiles_cas_check" CHECK ("stock_chemical_profiles"."cas_number" is null or "stock_chemical_profiles"."cas_number" ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'),
	CONSTRAINT "stock_chemical_profiles_text_check" CHECK (("stock_chemical_profiles"."storage_class" is null or char_length("stock_chemical_profiles"."storage_class") between 1 and 80)
        and ("stock_chemical_profiles"."incompatibility_note" is null or char_length("stock_chemical_profiles"."incompatibility_note") between 1 and 500)
        and ("stock_chemical_profiles"."sds_document_number" is null or char_length("stock_chemical_profiles"."sds_document_number") between 1 and 60)),
	CONSTRAINT "stock_chemical_profiles_sds_url_check" CHECK ("stock_chemical_profiles"."sds_url" is null or ("stock_chemical_profiles"."sds_url" ~ '^https://' and char_length("stock_chemical_profiles"."sds_url") <= 500))
);
--> statement-breakpoint
CREATE TABLE "stock_movement_lots" (
	"institution_id" text NOT NULL,
	"movement_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_movement_lots_pkey" PRIMARY KEY("institution_id","movement_id"),
	CONSTRAINT "stock_movement_lots_lot_number_check" CHECK (char_length("stock_movement_lots"."lot_number") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "stock_chemical_profiles" ADD CONSTRAINT "stock_chemical_profiles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_chemical_profiles" ADD CONSTRAINT "stock_chemical_profiles_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_movement_fkey" FOREIGN KEY ("institution_id","movement_id") REFERENCES "public"."stock_movements"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "stock_chemical_profiles" IS 'Stok kartının kimyasal bilgisi (DOM-FIN-090, ON-234, K-240): kart başına en çok bir satır; satırın varlığı kartı kimyasal yapar ve elle girişte parti ile son kullanma tarihi ister (K-241). Kaldırılmaz, düzeltilir. Kişi verisi taşımaz.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."item_id" IS 'Stok kartı (stock_items); kimyasal bilgisi kartla aynı kurumdadır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."hazard_pictograms" IS 'GHS tehlike piktogramları (SEA yönetmeliği, CLP): GHS01 patlayıcı … GHS09 çevre için tehlikeli; kod sırasıyla tekil, boş olabilir. Belgelerde kod olarak yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."signal_word" IS 'Sinyal kelimesi: danger (Tehlike) ya da warning (Dikkat); bazı tehlike sınıflarında yoktur, boş olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."cas_number" IS 'CAS numarası, NNNNNNN-NN-N biçiminde; sağlama basamağı core''da denetlenir. Karışımlarda boştur. Kurumda tekil değildir (aynı kimyasalın farklı ambalajları ayrı karttır).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."storage_class" IS 'Depolama sınıfı ya da dolabı, serbest metin (en çok 80 karakter; ör. yanıcı sıvı dolabı, TRGS 510 LGK 3).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."incompatibility_note" IS 'Birlikte depolanmaması gereken maddeler ve uyumsuzluk notu, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."sds_url" IS 'Güvenlik bilgi formu (GBF/SDS) bağlantısı; yalnız https, en çok 500 karakter. Dosya saklanmaz (K-240).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."sds_document_number" IS 'Kurumun tuttuğu GBF''nin belge ya da dosya numarası, en çok 60 karakter. Bağlantı ya da numaradan biri varsa raporda GBF var sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."sds_revision_date" IS 'GBF revizyon günü (Europe/Istanbul); bugünden sonra olamaz (core).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."archived_at" IS 'Arşiv zamanı; bugün kimyasal bilgisi arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_chemical_profiles"."version" IS 'İyimser kilit sürümü (If-Match; kimyasal bilgisi düzeltmesi).';--> statement-breakpoint
COMMENT ON TABLE "stock_movement_lots" IS 'Kimyasal girişinin partisi (DOM-FIN-090, ON-234, K-241): kimyasal kartın elle giriş hareketi başına bir satır. Parti miktarı saklanmaz; çıkışlar en yakın son kullanma önce (FEFO) hareketlerden düşülür, transfer partileri taşır (K-242). Hareket iptal edilince parti miktara girmez; satır değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."movement_id" IS 'Elle giriş hareketi (stock_movements, tür in); hareket başına bir parti.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."lot_number" IS 'Üreticinin parti (lot) numarası, 1–40 karakter. Aynı depoda aynı parti numarası ve son kullanma günü tek parti sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."expiry_date" IS 'Son kullanma günü: kullanılabilir son gün. Ertesi gün "süresi geçti", bugün dahil 30 gün içindeyse "süresi yaklaşıyor" (K-243).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."created_at" IS 'Oluşturma zamanı (UTC; hareketle aynı işlemde).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."updated_at" IS 'Son değişiklik zamanı (UTC); satır değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."archived_at" IS 'Arşiv zamanı; bugün parti arşivlenmez, hareket iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movement_lots"."version" IS 'Sürüm; parti satırı düzeltilmez.';
