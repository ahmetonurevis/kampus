CREATE TABLE "purchase_order_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"vat_rate" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_order_items_position_check" CHECK ("purchase_order_items"."position" >= 0),
	CONSTRAINT "purchase_order_items_name_check" CHECK (char_length("purchase_order_items"."name") between 2 and 200),
	CONSTRAINT "purchase_order_items_quantity_check" CHECK ("purchase_order_items"."quantity" between 1 and 1000000),
	CONSTRAINT "purchase_order_items_unit_check" CHECK ("purchase_order_items"."unit" in ('piece', 'pack', 'box', 'kilogram', 'liter', 'meter', 'hour', 'day', 'month', 'service')),
	CONSTRAINT "purchase_order_items_price_check" CHECK ("purchase_order_items"."unit_price_cents" between 1 and 100000000000),
	CONSTRAINT "purchase_order_items_vat_rate_check" CHECK ("purchase_order_items"."vat_rate" in (0, 1, 10, 20)),
	CONSTRAINT "purchase_order_items_currency_check" CHECK ("purchase_order_items"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"number" text NOT NULL,
	"number_year" integer NOT NULL,
	"number_sequence" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"request_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_type" text NOT NULL,
	"supplier_tax_number" text NOT NULL,
	"supplier_tax_office" text NOT NULL,
	"delivery_days" integer NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_orders_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_orders_sequence_check" CHECK ("purchase_orders"."number_sequence" > 0),
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('draft', 'sent', 'partially_received', 'completed', 'cancelled')),
	CONSTRAINT "purchase_orders_supplier_type_check" CHECK ("purchase_orders"."supplier_type" in ('company', 'individual')),
	CONSTRAINT "purchase_orders_delivery_days_check" CHECK ("purchase_orders"."delivery_days" between 0 and 365),
	CONSTRAINT "purchase_orders_text_check" CHECK (("purchase_orders"."note" is null or char_length("purchase_orders"."note") <= 500)
        and ("purchase_orders"."cancel_reason" is null or char_length("purchase_orders"."cancel_reason") <= 500)),
	CONSTRAINT "purchase_orders_lifecycle_check" CHECK ((("purchase_orders"."sent_at" is null) = ("purchase_orders"."sent_by_user_id" is null))
        and (("purchase_orders"."cancelled_at" is null) = ("purchase_orders"."cancelled_by_user_id" is null))
        and (("purchase_orders"."cancelled_at" is null) = ("purchase_orders"."cancel_reason" is null))
        and (("purchase_orders"."status" = 'cancelled') = ("purchase_orders"."cancelled_at" is not null))
        and ("purchase_orders"."status" <> 'draft' or "purchase_orders"."sent_at" is null)
        and ("purchase_orders"."status" not in ('sent', 'partially_received', 'completed') or "purchase_orders"."sent_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_quote_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"vat_rate" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_quote_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_quote_items_position_check" CHECK ("purchase_quote_items"."position" >= 0),
	CONSTRAINT "purchase_quote_items_price_check" CHECK ("purchase_quote_items"."unit_price_cents" between 1 and 100000000000),
	CONSTRAINT "purchase_quote_items_vat_rate_check" CHECK ("purchase_quote_items"."vat_rate" in (0, 1, 10, 20)),
	CONSTRAINT "purchase_quote_items_currency_check" CHECK ("purchase_quote_items"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "purchase_quotes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"delivery_days" integer NOT NULL,
	"valid_until" date NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"selected_at" timestamp with time zone,
	"selected_by_user_id" text,
	"selection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_quotes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_quotes_delivery_days_check" CHECK ("purchase_quotes"."delivery_days" between 0 and 365),
	CONSTRAINT "purchase_quotes_note_check" CHECK (("purchase_quotes"."note" is null or char_length("purchase_quotes"."note") <= 500)
        and ("purchase_quotes"."selection_reason" is null or char_length("purchase_quotes"."selection_reason") <= 500)),
	CONSTRAINT "purchase_quotes_selection_check" CHECK ((("purchase_quotes"."selected_at" is null) = ("purchase_quotes"."selected_by_user_id" is null))
        and ("purchase_quotes"."selected_at" is not null or "purchase_quotes"."selection_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_fkey" FOREIGN KEY ("institution_id","order_id") REFERENCES "public"."purchase_orders"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_request_item_fkey" FOREIGN KEY ("institution_id","request_item_id") REFERENCES "public"."purchase_request_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."purchase_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quote_fkey" FOREIGN KEY ("institution_id","quote_id") REFERENCES "public"."purchase_quotes"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quote_items" ADD CONSTRAINT "purchase_quote_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quote_items" ADD CONSTRAINT "purchase_quote_items_quote_fkey" FOREIGN KEY ("institution_id","quote_id") REFERENCES "public"."purchase_quotes"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quote_items" ADD CONSTRAINT "purchase_quote_items_request_item_fkey" FOREIGN KEY ("institution_id","request_item_id") REFERENCES "public"."purchase_request_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."purchase_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_supplier_fkey" FOREIGN KEY ("institution_id","supplier_id") REFERENCES "public"."suppliers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_items_position_key" ON "purchase_order_items" USING btree ("institution_id","order_id","position");--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("institution_id","order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_request_item_idx" ON "purchase_order_items" USING btree ("institution_id","request_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders" USING btree ("institution_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_sequence_key" ON "purchase_orders" USING btree ("institution_id","number_year","number_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_active_request_key" ON "purchase_orders" USING btree ("institution_id","request_id") WHERE "purchase_orders"."status" <> 'cancelled' and "purchase_orders"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_request_idx" ON "purchase_orders" USING btree ("institution_id","request_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_quote_idx" ON "purchase_orders" USING btree ("institution_id","quote_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("institution_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_quote_items_request_item_key" ON "purchase_quote_items" USING btree ("institution_id","quote_id","request_item_id") WHERE "purchase_quote_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_quote_items_quote_idx" ON "purchase_quote_items" USING btree ("institution_id","quote_id");--> statement-breakpoint
CREATE INDEX "purchase_quote_items_request_item_idx" ON "purchase_quote_items" USING btree ("institution_id","request_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_quotes_supplier_key" ON "purchase_quotes" USING btree ("institution_id","request_id","supplier_id") WHERE "purchase_quotes"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_quotes_selected_key" ON "purchase_quotes" USING btree ("institution_id","request_id") WHERE "purchase_quotes"."archived_at" is null and "purchase_quotes"."selected_at" is not null;--> statement-breakpoint
CREATE INDEX "purchase_quotes_request_idx" ON "purchase_quotes" USING btree ("institution_id","request_id");--> statement-breakpoint
CREATE INDEX "purchase_quotes_supplier_idx" ON "purchase_quotes" USING btree ("institution_id","supplier_id");--> statement-breakpoint
COMMENT ON TABLE "purchase_quotes" IS 'Satın alma teklifi (DOM-FIN-072, ON-224): onaylanmış talebe tedarikçi başına bir teklif; talep başına en çok 10. Seçim bu satırdadır, talepte tek seçili teklif olur; etkin siparişi olan talebin teklifleri kilitlidir. Tutar kalemlerden hesaplanır, saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."id" IS 'Teklif kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."request_id" IS 'Satın alma talebi (purchase_requests); yalnız onaylanmış talep.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."supplier_id" IS 'Teklifi veren tedarikçi (suppliers); talepte tedarikçi başına bir silinmemiş teklif.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."delivery_days" IS 'Teslim süresi, gün (0–365); beklenen teslim günü siparişte hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."valid_until" IS 'Teklifin son geçerlilik günü (Europe/Istanbul, son gün dahil); geçmiş teklif seçilemez ve en düşük vurgusuna girmez.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."note" IS 'İsteğe bağlı not, en çok 500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."created_by_user_id" IS 'Teklifi giren kullanıcı; ön büro yalnız kendi teklifini değiştirir (K-136).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."selected_at" IS 'Seçim zamanı; boşsa seçili değil. Teklif düzeltilir ya da silinirse seçim düşer (K-137).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."selected_by_user_id" IS 'Teklifi seçen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."selection_reason" IS 'Seçim gerekçesi; en düşük geçerli teklif seçilmediyse zorunlu (en az 10, en çok 500 karakter; K-137).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."archived_at" IS 'Silinme (arşiv) zamanı; silinen teklif karşılaştırmaya girmez.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quotes"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "purchase_quote_items" IS 'Teklif kalemi (DOM-FIN-072): talep kalemine KDV hariç birim fiyat ve KDV oranı. Teklif talebin bütün kalemlerini kapsar (K-135); düzeltmede eski kalemler arşivlenir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."id" IS 'Teklif kalemi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."quote_id" IS 'Teklif (purchase_quotes).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."request_item_id" IS 'Fiyat verilen talep kalemi (purchase_request_items); teklifte kalem başına bir etkin fiyat.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."position" IS 'Teklif içindeki sıra (0’dan başlar).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."unit_price_cents" IS 'KDV hariç birim fiyat, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."vat_rate" IS 'KDV oranı, yüzde: 0, 1, 10 ya da 20 (K-138). KDV kalemde net × oran / 100 yarım kuruş yukarı yuvarlanır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."archived_at" IS 'Teklif düzeltmesinde eski kalemin arşivlenme zamanı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_quote_items"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "purchase_orders" IS 'Satın alma siparişi (DOM-FIN-073, ON-225): seçili tekliften açılır; tedarikçi ve kalemler açılış anının kopyasıdır. Numara SA-<yıl>-<sıra> (K-139). Durum taslak → gönderildi → kısmen teslim → tamamlandı; taslak ve gönderilmiş sipariş iptal edilir. Talepte en çok bir etkin (iptal edilmemiş) sipariş olur; onaylı talep yalnız siparişle kapanır (K-140).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."id" IS 'Sipariş kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."number" IS 'Sipariş numarası SA-<yıl>-<sıra>; kurumda tekil.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."number_year" IS 'Numaranın yılı: açılış anının Europe/Istanbul takvim yılı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."number_sequence" IS 'Yıl içindeki sıra; kurum kilidi altında verilir, kurum ve yılda tekil, iptal edilen numara boşta kalır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."status" IS 'Durum: draft (taslak), sent (gönderildi), partially_received (kısmen teslim, ON-226), completed (tamamlandı, ON-226), cancelled (iptal).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."request_id" IS 'Siparişin talebi (purchase_requests); talep → teklif → sipariş bağı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."quote_id" IS 'Siparişin açıldığı seçili teklif (purchase_quotes).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."supplier_id" IS 'Tedarikçi (suppliers).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."supplier_name" IS 'Tedarikçi unvanı, açılış anı kopyası.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."supplier_type" IS 'Tedarikçi türü kopyası: company ya da individual.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."supplier_tax_number" IS 'Vergi numarası kopyası (VKN ya da şahısta TCKN; kişisel veri, ön büroya maskeli, loglanmaz).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."supplier_tax_office" IS 'Vergi dairesi kopyası.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."delivery_days" IS 'Tekliften kopyalanan teslim süresi, gün; beklenen teslim günü gönderim (yoksa açılış) günü artı bu süredir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."note" IS 'İsteğe bağlı sipariş notu, en çok 500 karakter; PDF’e yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."created_by_user_id" IS 'Siparişi açan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."sent_at" IS 'Gönderildi işareti zamanı; PDF kurum dışından iletilir, e-posta gönderilmez (K-142).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."sent_by_user_id" IS 'Gönderildi işaretleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."cancelled_at" IS 'İptal zamanı.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."cancelled_by_user_id" IS 'İptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."archived_at" IS 'Arşiv zamanı; bugün sipariş arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "purchase_order_items" IS 'Sipariş kalemi (DOM-FIN-073): talep kalemi ve seçili teklif fiyatının açılış anındaki kopyası; sonradan teklif değişse de değişmez. Tutar ve KDV hesaplanır, saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."id" IS 'Sipariş kalemi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."order_id" IS 'Sipariş (purchase_orders).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."request_item_id" IS 'Kaynak talep kalemi (purchase_request_items); mal kabul (ON-226) bu bağı kullanır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."position" IS 'Sipariş içindeki sıra; siparişte tekil.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."name" IS 'Kalem adı kopyası, 2–200 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."quantity" IS 'Miktar kopyası, tam sayı 1–1.000.000.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."unit" IS 'Birim kopyası (adet, paket, koli, kg, litre, metre, saat, gün, ay, hizmet).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."unit_price_cents" IS 'KDV hariç birim fiyat kopyası, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."vat_rate" IS 'KDV oranı kopyası, yüzde (0, 1, 10, 20).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."archived_at" IS 'Arşiv zamanı; bugün kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_order_items"."version" IS 'İyimser kilit sürümü (If-Match).';
