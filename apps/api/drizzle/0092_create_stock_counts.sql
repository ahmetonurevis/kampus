CREATE TABLE "stock_count_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"system_quantity" integer NOT NULL,
	"counted_quantity" integer,
	"counted_at" timestamp with time zone,
	"counted_by_user_id" text,
	"expected_quantity" integer,
	"unit_cost_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"stock_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_count_lines_quantity_check" CHECK ("stock_count_lines"."system_quantity" >= 0
        and ("stock_count_lines"."counted_quantity" is null or "stock_count_lines"."counted_quantity" between 0 and 1000000)
        and (("stock_count_lines"."counted_quantity" is null) = ("stock_count_lines"."counted_at" is null))
        and (("stock_count_lines"."counted_at" is null) = ("stock_count_lines"."counted_by_user_id" is null))
        and ("stock_count_lines"."stock_movement_id" is null or "stock_count_lines"."expected_quantity" is not null)
        and ("stock_count_lines"."unit_cost_cents" is null or "stock_count_lines"."unit_cost_cents" > 0)),
	CONSTRAINT "stock_count_lines_currency_check" CHECK ("stock_count_lines"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"started_at" timestamp with time zone NOT NULL,
	"started_by_user_id" text NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"adjustment_date" date,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_counts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_counts_status_check" CHECK ("stock_counts"."status" in ('open', 'completed', 'cancelled')),
	CONSTRAINT "stock_counts_state_check" CHECK (("stock_counts"."status" = 'open' and "stock_counts"."completed_at" is null and "stock_counts"."completed_by_user_id" is null and "stock_counts"."adjustment_date" is null and "stock_counts"."cancelled_at" is null and "stock_counts"."cancelled_by_user_id" is null and "stock_counts"."cancel_reason" is null)
        or ("stock_counts"."status" = 'completed' and "stock_counts"."completed_at" is not null and "stock_counts"."completed_by_user_id" is not null and "stock_counts"."adjustment_date" is not null and "stock_counts"."cancelled_at" is null and "stock_counts"."cancelled_by_user_id" is null and "stock_counts"."cancel_reason" is null)
        or ("stock_counts"."status" = 'cancelled' and "stock_counts"."completed_at" is null and "stock_counts"."completed_by_user_id" is null and "stock_counts"."adjustment_date" is null and "stock_counts"."cancelled_at" is not null and "stock_counts"."cancelled_by_user_id" is not null and "stock_counts"."cancel_reason" is not null)),
	CONSTRAINT "stock_counts_text_check" CHECK (("stock_counts"."note" is null or char_length("stock_counts"."note") <= 500)
        and ("stock_counts"."cancel_reason" is null or char_length("stock_counts"."cancel_reason") <= 500))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fkey" FOREIGN KEY ("institution_id","count_id") REFERENCES "public"."stock_counts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_movement_fkey" FOREIGN KEY ("institution_id","stock_movement_id") REFERENCES "public"."stock_movements"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_fkey" FOREIGN KEY ("institution_id","warehouse_id") REFERENCES "public"."stock_warehouses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_count_item_key" ON "stock_count_lines" USING btree ("institution_id","count_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_count_lines_item_idx" ON "stock_count_lines" USING btree ("institution_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_movement_key" ON "stock_count_lines" USING btree ("institution_id","stock_movement_id") WHERE "stock_count_lines"."stock_movement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_open_key" ON "stock_counts" USING btree ("institution_id","warehouse_id") WHERE "stock_counts"."status" = 'open' and "stock_counts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "stock_counts_warehouse_idx" ON "stock_counts" USING btree ("institution_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_counts_started_idx" ON "stock_counts" USING btree ("institution_id","started_at");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('in', 'out', 'transfer_in', 'transfer_out', 'receipt', 'delivery', 'adjustment_in', 'adjustment_out'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK (("stock_movements"."type" = 'in' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('opening', 'donation', 'count_surplus', 'returned', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'out' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('usage', 'damage', 'loss', 'count_shortage', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" in ('transfer_in', 'transfer_out') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is not null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'receipt' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is not null and "stock_movements"."receipt_item_id" is not null)
        or ("stock_movements"."type" = 'delivery' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" in ('adjustment_in', 'adjustment_out') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null));--> statement-breakpoint
COMMENT ON TABLE "stock_counts" IS 'Stok sayımı (DOM-FIN-081, ON-231): bir depoda başlatılan sayım oturumu. Başlatılınca depodaki sistem miktarları stock_count_lines satırlarına anlık görüntü olarak yazılır. Durum open → completed ya da cancelled; aynı depoda tek açık sayım olur (stock_counts_open_key). Tamamlama farkları tek işlemde adjustment_in/adjustment_out stok hareketiyle yazar; iptal hareket yazmaz. Tamamlanan ve iptal edilen sayım değişmez (K-228…K-231).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."id" IS 'Sayım kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."warehouse_id" IS 'Sayılan depo (stock_warehouses); başlatırken ve tamamlarken etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."status" IS 'Durum: open (sürüyor; kart okutulur, miktar girilir), completed (tamamlandı; farklar düzeltme hareketiyle yazıldı), cancelled (iptal edildi; hareket yazılmadı).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."note" IS 'İsteğe bağlı açıklama (sayım ekibi, raf), en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."started_at" IS 'Sayımın başladığı an (UTC); anlık görüntü bu andaki miktardır. Sayım sırasındaki hareketler bu andan sonra kaydedilen ya da iptal edilenlerdir (K-231).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."started_by_user_id" IS 'Sayımı başlatan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."completed_at" IS 'Tamamlama anı (UTC); yalnız completed durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."completed_by_user_id" IS 'Sayımı tamamlayan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."adjustment_date" IS 'Düzeltme hareketlerinin günü (tamamlama günü, Europe/Istanbul); yalnız completed durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."cancelled_at" IS 'İptal anı (UTC); yalnız cancelled durumunda dolu.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."cancelled_by_user_id" IS 'Sayımı iptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter (core).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."archived_at" IS 'Arşiv zamanı; bugün sayım arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_counts"."version" IS 'İyimser kilit sürümü (If-Match; tamamlama ve iptal). Okutma ve miktar girişi sürümü artırmaz.';--> statement-breakpoint
COMMENT ON TABLE "stock_count_lines" IS 'Stok sayımı satırı (DOM-FIN-081): kart başına anlık görüntüdeki sistem miktarı ve sayılan miktar. Anlık görüntüde olmayan kart sayılınca sistem miktarı 0 olan satır açılır. Tamamlamada beklenen miktar, birim maliyet ve fark varsa düzeltme hareketi yazılır; fark raporu bu değerlerle sabit kalır. Sayılmayan satır değişmez, sıfıra çekilmez (K-230).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."id" IS 'Satır kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."count_id" IS 'Sayım (stock_counts); sayımda kart başına bir satır (stock_count_lines_count_item_key).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."item_id" IS 'Stok kartı (stock_items).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."system_quantity" IS 'Anlık görüntü: sayım başladığında depodaki miktar (iptal edilmemiş hareketlerin toplamı), kartın biriminde.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."counted_quantity" IS 'Sayılan miktar, 0–1.000.000; boşsa kalem sayılmadı. Okutma 1 ya da girilen miktarı ekler, elle giriş doğrudan yazar (K-229).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."counted_at" IS 'Satırın son sayıldığı an (UTC). Beklenen miktar anlık görüntüye sayım başlangıcından bu ana kadarki hareketler eklenerek bulunur (K-231).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."counted_by_user_id" IS 'Satırı son sayan kullanıcı (yönetici ya da ön büro).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."expected_quantity" IS 'Tamamlamada saklanan beklenen miktar (anlık görüntü + sayım sırasındaki hareketler); açık sayımda boş, hesaplanır. Fark = sayılan − beklenen.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."unit_cost_cents" IS 'Tamamlamada saklanan birim maliyet: kartın son alış fiyatı (iptal edilmemiş en son mal kabul girişinin sipariş birim fiyatı, KDV hariç, kuruş; K-202). Bilinmiyorsa boş, fark tutarı hesaplanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."stock_movement_id" IS 'Farkı yazan düzeltme hareketi (stock_movements, adjustment_in ya da adjustment_out); fark yoksa ya da sayım tamamlanmadıysa boş. Hareket iptal edilmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."archived_at" IS 'Arşiv zamanı; bugün satır arşivlenmez, sayımı geri alınır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_lines"."version" IS 'Satır sürümü; her sayım değişikliğinde artar.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."type" IS 'Tür: in (elle giriş), out (çıkış), transfer_in ve transfer_out (depolar arası transferin iki bacağı), receipt (mal kabul girişi), delivery (materyal seti teslimi çıkışı, DOM-FIN-080; kaynağı material_delivery_items), adjustment_in ve adjustment_out (stok sayımı fazla ve eksik düzeltmesi, DOM-FIN-081; kaynağı stock_count_lines, iptal edilmez). in, transfer_in, receipt ve adjustment_in miktarı artırır.';
