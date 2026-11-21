CREATE TABLE "fixed_asset_count_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"in_scope" boolean NOT NULL,
	"tag_number" text NOT NULL,
	"asset_name" text NOT NULL,
	"recorded_campus_id" text,
	"recorded_location" text NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"observed_campus_id" text,
	"observed_location" text,
	"scanned_at" timestamp with time zone,
	"scanned_by_user_id" text,
	"relocated_at" timestamp with time zone,
	"relocated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixed_asset_count_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "fixed_asset_count_items_result_check" CHECK ("fixed_asset_count_items"."result" in ('pending', 'found', 'misplaced')),
	CONSTRAINT "fixed_asset_count_items_scan_check" CHECK ((("fixed_asset_count_items"."result" = 'pending') = ("fixed_asset_count_items"."scanned_at" is null))
        and (("fixed_asset_count_items"."scanned_at" is null) = ("fixed_asset_count_items"."scanned_by_user_id" is null))
        and (("fixed_asset_count_items"."scanned_at" is null) = ("fixed_asset_count_items"."observed_location" is null))
        and ("fixed_asset_count_items"."scanned_at" is not null or "fixed_asset_count_items"."observed_campus_id" is null)
        and ("fixed_asset_count_items"."in_scope" or "fixed_asset_count_items"."result" <> 'pending')
        and (("fixed_asset_count_items"."relocated_at" is null) = ("fixed_asset_count_items"."relocated_by_user_id" is null))
        and ("fixed_asset_count_items"."relocated_at" is null or "fixed_asset_count_items"."result" = 'misplaced')),
	CONSTRAINT "fixed_asset_count_items_text_check" CHECK (char_length("fixed_asset_count_items"."recorded_location") between 2 and 120
        and ("fixed_asset_count_items"."observed_location" is null
          or char_length("fixed_asset_count_items"."observed_location") between 2 and 120))
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_counts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"campus_id" text,
	"location" text,
	"scope_key" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by_user_id" text NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixed_asset_counts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "fixed_asset_counts_scope_type_check" CHECK ("fixed_asset_counts"."scope_type" in ('institution', 'campus', 'location')),
	CONSTRAINT "fixed_asset_counts_scope_check" CHECK (("fixed_asset_counts"."scope_type" = 'institution' and "fixed_asset_counts"."campus_id" is null and "fixed_asset_counts"."location" is null)
        or ("fixed_asset_counts"."scope_type" = 'campus' and "fixed_asset_counts"."campus_id" is not null and "fixed_asset_counts"."location" is null)
        or ("fixed_asset_counts"."scope_type" = 'location' and "fixed_asset_counts"."location" is not null
          and char_length("fixed_asset_counts"."location") between 2 and 120)),
	CONSTRAINT "fixed_asset_counts_note_check" CHECK ("fixed_asset_counts"."note" is null or char_length("fixed_asset_counts"."note") between 1 and 200),
	CONSTRAINT "fixed_asset_counts_status_check" CHECK ("fixed_asset_counts"."status" in ('open', 'completed', 'cancelled')),
	CONSTRAINT "fixed_asset_counts_close_check" CHECK ((("fixed_asset_counts"."status" = 'completed') = ("fixed_asset_counts"."completed_at" is not null))
        and (("fixed_asset_counts"."completed_at" is null) = ("fixed_asset_counts"."completed_by_user_id" is null))
        and (("fixed_asset_counts"."status" = 'cancelled') = ("fixed_asset_counts"."cancelled_at" is not null))
        and (("fixed_asset_counts"."cancelled_at" is null) = ("fixed_asset_counts"."cancelled_by_user_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "fixed_asset_count_items" ADD CONSTRAINT "fixed_asset_count_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_count_items" ADD CONSTRAINT "fixed_asset_count_items_count_fkey" FOREIGN KEY ("institution_id","count_id") REFERENCES "public"."fixed_asset_counts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_count_items" ADD CONSTRAINT "fixed_asset_count_items_asset_fkey" FOREIGN KEY ("institution_id","asset_id") REFERENCES "public"."fixed_assets"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_counts" ADD CONSTRAINT "fixed_asset_counts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_count_items_asset_key" ON "fixed_asset_count_items" USING btree ("institution_id","count_id","asset_id");--> statement-breakpoint
CREATE INDEX "fixed_asset_count_items_count_idx" ON "fixed_asset_count_items" USING btree ("institution_id","count_id","result","tag_number");--> statement-breakpoint
CREATE INDEX "fixed_asset_count_items_asset_idx" ON "fixed_asset_count_items" USING btree ("institution_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_counts_open_key" ON "fixed_asset_counts" USING btree ("institution_id","scope_key") WHERE "fixed_asset_counts"."status" = 'open' and "fixed_asset_counts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "fixed_asset_counts_status_idx" ON "fixed_asset_counts" USING btree ("institution_id","status","started_at");--> statement-breakpoint
COMMENT ON TABLE "fixed_asset_counts" IS 'Demirbaş sayımı (DOM-FIN-087, ON-237): bütün kurum, bir kampüs ya da bir oda kapsamında fiziksel sayım oturumu. Başlarken kapsamdaki hurdaya ayrılmamış demirbaşlar fixed_asset_count_items satırlarına dondurulur (K-232). Aynı kapsamda tek açık sayım (fixed_asset_counts_open_key, K-234). Silinmez; open → completed ya da cancelled. Tamamlama demirbaş kaydını değiştirmez (K-235). Yalnız yönetici okur ve yazar (K-189).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."id" IS 'Sayım kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."scope_type" IS 'Kapsam: institution bütün kurum, campus bir kampüs, location bir oda ya da yer (K-232).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."campus_id" IS 'Kampüs sayımında zorunlu, oda sayımında isteğe bağlı kampüs: records tablosundaki branches kaydının kimliği. Yabancı anahtar yoktur, başlatırken sunucuda denetlenir. Kurum sayımında boş.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."location" IS 'Oda sayımında sayılan oda ya da yer, serbest metin, 2–120 karakter; demirbaş konumuyla harf ve boşluk farkı gözetmeden eşleşir. Öteki kapsamlarda boş.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."scope_key" IS 'Kapsam anahtarı (core fixedAssetCountScopeKey): institution, campus:<kampüs> ya da location:<kampüs|->:<katlanmış konum>. Açık sayım tekilliği bu anahtar üzerindedir (K-234).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."note" IS 'İsteğe bağlı açıklama (ör. yıl sonu sayımı), en çok 200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."status" IS 'Durum: open sürüyor (okutma yapılır), completed tamamlandı (okunmayan beklenen demirbaş bulunamadı sayılır), cancelled iptal edildi. Kapanan sayım yeniden açılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."started_at" IS 'Sayımın başladığı ve beklenen listenin dondurulduğu zaman (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."started_by_user_id" IS 'Sayımı başlatan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."completed_at" IS 'Tamamlama zamanı (UTC); yalnız completed durumunda dolu. Demirbaşın son sayım bilgisi bu zamandan okunur.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."completed_by_user_id" IS 'Sayımı tamamlayan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."cancelled_at" IS 'İptal zamanı (UTC); yalnız cancelled durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."cancelled_by_user_id" IS 'Sayımı iptal eden kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."updated_at" IS 'Son değişiklik zamanı (UTC); tamamlama ve iptalde değişir, okutmada değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."archived_at" IS 'Arşiv zamanı; sayım arşivlenmez, iptal edilir. Açık sayım tekilliği arşivlenmemiş satırlar arasındadır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_counts"."version" IS 'İyimser kilit sürümü (If-Match; tamamlama ve iptal). Okutma sürümü artırmaz.';--> statement-breakpoint
COMMENT ON TABLE "fixed_asset_count_items" IS 'Demirbaş sayım satırı (DOM-FIN-087): beklenen listedeki her demirbaş (in_scope true, başlangıçta pending) ve okutulan, listede olmayan kurum demirbaşı (in_scope false). Etiket, ad ve kayıtlı yer başlangıç ya da okutma anının kopyasıdır. Okutma bir kez yazılır (K-233); konum düzeltmesi yalnız yanlış konumdaki satırda yapılır (K-235). Kişi verisi yalnız kullanıcı kimlikleridir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."id" IS 'Satır kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."count_id" IS 'Sayım (fixed_asset_counts); silinemez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."asset_id" IS 'Sayılan demirbaş (fixed_assets); bir sayımda bir kez (fixed_asset_count_items_asset_key).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."in_scope" IS 'Demirbaş sayım başlarken beklenen listede miydi. false: sonradan okutulan, kapsam dışı ya da sayım başladıktan sonra kaydedilen/taşınan kurum demirbaşı; bu satır yalnız okutulunca oluşur.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."tag_number" IS 'Etiket numarasının sayım anındaki kopyası (karekod içeriği).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."asset_name" IS 'Demirbaş adının sayım anındaki kopyası; rapor sonradan yapılan düzeltmeden etkilenmez.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."recorded_campus_id" IS 'Demirbaş kaydındaki kampüsün kopyası (beklenen satırda başlangıç, listede olmayan satırda okutma anı); branches kaydı kimliği, yabancı anahtar yok.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."recorded_location" IS 'Demirbaş kaydındaki konumun kopyası, 2–120 karakter; sayılan yerle karşılaştırılır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."result" IS 'Sonuç: pending okunmadı (tamamlanmış sayımda bulunamadı), found sayılan yer kayıtlı yerle aynı, misplaced farklı yerde bulundu. Bulunamayan demirbaş hurdaya ayrılmaz (K-235).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."observed_campus_id" IS 'Demirbaşın okutulduğu kampüs (branches kaydı); kampüssüz yerde ya da okunmayan satırda boş. Okutmada sunucuda denetlenir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."observed_location" IS 'Demirbaşın okutulduğu oda ya da yer, 2–120 karakter; okunmayan satırda boş. Oda sayımında sayımın odasıdır.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."scanned_at" IS 'İlk okutma zamanı (UTC); ikinci okutma değiştirmez.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."scanned_by_user_id" IS 'Okutan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."relocated_at" IS 'Konum düzeltmesi zamanı (UTC): tamamlanmış sayımda yönetici onayıyla demirbaşın kampüs ve konumu sayılan yere yazıldı (K-235). Yalnız misplaced satırda.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."relocated_by_user_id" IS 'Konumu düzelten kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."created_at" IS 'Oluşturma zamanı (UTC): beklenen satırda sayım başlangıcı, listede olmayan satırda okutma.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."updated_at" IS 'Son değişiklik zamanı (UTC); okutma ve konum düzeltmesinde değişir.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."archived_at" IS 'Arşiv zamanı; sayım satırı arşivlenmez.';--> statement-breakpoint
COMMENT ON COLUMN "fixed_asset_count_items"."version" IS 'İyimser kilit sürümü (If-Match; konum düzeltmesi).';
