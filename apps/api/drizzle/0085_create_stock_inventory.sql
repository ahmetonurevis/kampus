CREATE TABLE "stock_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"min_quantity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_items_text_check" CHECK ("stock_items"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'
        and char_length("stock_items"."name") between 2 and 120),
	CONSTRAINT "stock_items_category_check" CHECK ("stock_items"."category" in ('stationery', 'cleaning', 'food', 'it', 'maintenance', 'furniture', 'educational', 'services', 'transport', 'other')),
	CONSTRAINT "stock_items_unit_check" CHECK ("stock_items"."unit" in ('piece', 'pack', 'box', 'kilogram', 'liter', 'meter')),
	CONSTRAINT "stock_items_min_quantity_check" CHECK ("stock_items"."min_quantity" is null or "stock_items"."min_quantity" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"movement_date" date NOT NULL,
	"reason" text,
	"note" text,
	"transfer_id" uuid,
	"receipt_id" uuid,
	"receipt_item_id" uuid,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_movements_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('in', 'out', 'transfer_in', 'transfer_out', 'receipt')),
	CONSTRAINT "stock_movements_quantity_check" CHECK ("stock_movements"."quantity" between 1 and 1000000),
	CONSTRAINT "stock_movements_source_check" CHECK (("stock_movements"."type" = 'in' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('opening', 'donation', 'count_surplus', 'returned', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'out' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('usage', 'damage', 'loss', 'count_shortage', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" in ('transfer_in', 'transfer_out') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is not null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'receipt' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is not null and "stock_movements"."receipt_item_id" is not null)),
	CONSTRAINT "stock_movements_text_check" CHECK (("stock_movements"."note" is null or char_length("stock_movements"."note") <= 500)
        and ("stock_movements"."cancel_reason" is null or char_length("stock_movements"."cancel_reason") <= 500)),
	CONSTRAINT "stock_movements_cancel_check" CHECK ((("stock_movements"."cancelled_at" is null) = ("stock_movements"."cancelled_by_user_id" is null))
        and (("stock_movements"."cancelled_at" is null) = ("stock_movements"."cancel_reason" is null)))
);
--> statement-breakpoint
CREATE TABLE "stock_warehouses" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"campus_id" text NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_warehouses_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_warehouses_text_check" CHECK (char_length("stock_warehouses"."name") between 2 and 80
        and char_length("stock_warehouses"."campus_id") between 1 and 100
        and ("stock_warehouses"."note" is null or char_length("stock_warehouses"."note") <= 500))
);
--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_fkey" FOREIGN KEY ("institution_id","warehouse_id") REFERENCES "public"."stock_warehouses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_fkey" FOREIGN KEY ("institution_id","receipt_id") REFERENCES "public"."purchase_receipts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_item_fkey" FOREIGN KEY ("institution_id","receipt_item_id") REFERENCES "public"."purchase_receipt_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_warehouses" ADD CONSTRAINT "stock_warehouses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_code_key" ON "stock_items" USING btree ("institution_id","code") WHERE "stock_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "stock_movements_item_warehouse_idx" ON "stock_movements" USING btree ("institution_id","item_id","warehouse_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_warehouse_idx" ON "stock_movements" USING btree ("institution_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_movements_date_idx" ON "stock_movements" USING btree ("institution_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_transfer_idx" ON "stock_movements" USING btree ("institution_id","transfer_id") WHERE "stock_movements"."transfer_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_receipt_idx" ON "stock_movements" USING btree ("institution_id","receipt_id") WHERE "stock_movements"."receipt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_receipt_item_key" ON "stock_movements" USING btree ("institution_id","receipt_item_id") WHERE "stock_movements"."receipt_item_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_warehouses_campus_idx" ON "stock_warehouses" USING btree ("institution_id","campus_id");--> statement-breakpoint
COMMENT ON TABLE "stock_items" IS 'Stok kartı (DOM-FIN-077, ON-228): kurumun stokta tuttuğu ürün. Miktar saklanmaz, iptal edilmemiş stok hareketlerinden (stock_movements) ürün × depo için türetilir. Kod kurumda tekildir; kart silinmez, is_active ile pasifleşir (miktarı sıfırken, K-182).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."id" IS 'Stok kartı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."code" IS 'Ürün kodu: büyük harf, rakam, nokta, alt çizgi, tire; en çok 20 karakter. Kurumda arşivlenmemiş kartlar arasında tekil (stock_items_code_key).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."name" IS 'Ürün adı, 2–120 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."category" IS 'Kategori; tedarikçi kategorileriyle aynı sabit küme (DOM-FIN-070, K-125).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."unit" IS 'Stok birimi: piece, pack, box, kilogram, liter, meter (K-182). Hareketi olan kartın birimi değişmez; mal kabulde sipariş kaleminin birimiyle aynı olmalıdır (K-184).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."min_quantity" IS 'Kritik seviye; kurum geneli toplam miktar buna eşit ya da altındaysa kart kritik görünür. Boşsa kritik seviye yok.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."is_active" IS 'Etkin mi; pasif kartla hareket yazılmaz, miktarı olan kart pasifleşmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."archived_at" IS 'Arşiv zamanı; bugün kart arşivlenmez, pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."version" IS 'İyimser kilit sürümü (If-Match; kart düzeltmesi).';--> statement-breakpoint
COMMENT ON TABLE "stock_warehouses" IS 'Depo (DOM-FIN-077, ON-228): kurumun bir kampüsüne bağlı stok yeri. Ad kurumda tekildir (Türkçe harf ve büyük/küçük harf duyarsız, core denetimi). Stoku olan depo pasifleşmez ve başka kampüse bağlanmaz (K-180).';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."id" IS 'Depo kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."name" IS 'Depo adı, 2–80 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."campus_id" IS 'Bağlı kampüs: records tablosunda branches koleksiyonundaki kaydın kimliği; açılış ve kampüs değişikliğinde etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."note" IS 'İsteğe bağlı açıklama (raf, sorumlu birim), en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."is_active" IS 'Etkin mi; pasif depoya ve depodan hareket yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."archived_at" IS 'Arşiv zamanı; bugün depo arşivlenmez, pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_warehouses"."version" IS 'İyimser kilit sürümü (If-Match; depo düzeltmesi).';--> statement-breakpoint
COMMENT ON TABLE "stock_movements" IS 'Stok hareketi (DOM-FIN-078, ON-229): bir ürünün bir depoya girişi ya da çıkışı. Ürün × depo miktarı iptal edilmemiş hareketlerin toplamıdır ve hiçbir günün sonunda eksiye düşemez (kurum kilidi altında denetlenir, K-181). Transfer aynı transfer_id ile iki harekettir; mal kabul girişi kabul kalemine bağlıdır. Silinmez, yönetici gerekçeyle iptal eder (K-183).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."id" IS 'Hareket kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."item_id" IS 'Stok kartı (stock_items).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."warehouse_id" IS 'Depo (stock_warehouses).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."type" IS 'Tür: in (elle giriş), out (çıkış), transfer_in ve transfer_out (depolar arası transferin iki bacağı), receipt (mal kabul girişi). in, transfer_in ve receipt miktarı artırır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."quantity" IS 'Miktar, kartın biriminde, 1–1.000.000; işaret türden gelir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."movement_date" IS 'Hareket günü (Europe/Istanbul); bugünden sonra olamaz. Mal kabul girişinde kabul günüdür.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."reason" IS 'Neden: elle girişte opening, donation, count_surplus, returned, other; çıkışta usage, damage, loss, count_shortage, other. Transfer ve mal kabulde boş.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."note" IS 'İsteğe bağlı açıklama, en çok 500 karakter; neden other ise zorunlu (en az 3 karakter, core).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."transfer_id" IS 'Transferin iki hareketini bağlayan kimlik; yalnız transfer_in ve transfer_out hareketlerinde dolu. İki hareket birlikte iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."receipt_id" IS 'Mal kabul (purchase_receipts); yalnız receipt türünde dolu. Bu hareket yalnız kabul iptaliyle iptal edilir (K-184).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."receipt_item_id" IS 'Mal kabul kalemi (purchase_receipt_items); kalem başına bir hareket (stock_movements_receipt_item_key).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."created_by_user_id" IS 'Hareketi kaydeden kullanıcı (yönetici; çıkışta ön büro da, K-180).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."cancelled_at" IS 'İptal zamanı; iptal edilen hareket miktara girmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."cancelled_by_user_id" IS 'Hareketi iptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."archived_at" IS 'Arşiv zamanı; bugün hareket arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."version" IS 'İyimser kilit sürümü (If-Match; hareket iptali).';