CREATE TABLE "supplier_invoice_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"order_item_id" uuid,
	"description" text,
	"quantity" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supplier_invoice_lines_position_check" CHECK ("supplier_invoice_lines"."position" >= 0),
	CONSTRAINT "supplier_invoice_lines_quantity_check" CHECK ("supplier_invoice_lines"."quantity" between 1 and 1000000),
	CONSTRAINT "supplier_invoice_lines_price_check" CHECK ("supplier_invoice_lines"."unit_price_cents" between 1 and 100000000000),
	CONSTRAINT "supplier_invoice_lines_currency_check" CHECK ("supplier_invoice_lines"."currency" = 'TRY'),
	CONSTRAINT "supplier_invoice_lines_description_check" CHECK (("supplier_invoice_lines"."order_item_id" is null) = ("supplier_invoice_lines"."description" is not null)
        and ("supplier_invoice_lines"."description" is null or char_length("supplier_invoice_lines"."description") between 2 and 200))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "match_approved_status" text;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "match_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "match_approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "match_approval_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_fkey" FOREIGN KEY ("institution_id","invoice_id") REFERENCES "public"."supplier_invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_order_item_fkey" FOREIGN KEY ("institution_id","order_item_id") REFERENCES "public"."purchase_order_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_lines_position_key" ON "supplier_invoice_lines" USING btree ("institution_id","invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_lines_order_item_key" ON "supplier_invoice_lines" USING btree ("institution_id","invoice_id","order_item_id") WHERE "supplier_invoice_lines"."order_item_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_invoice_idx" ON "supplier_invoice_lines" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_order_item_idx" ON "supplier_invoice_lines" USING btree ("institution_id","order_item_id");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_match_approval_check" CHECK (("supplier_invoices"."match_approved_status" is null) = ("supplier_invoices"."match_approved_at" is null)
        and ("supplier_invoices"."match_approved_at" is null) = ("supplier_invoices"."match_approved_by_user_id" is null)
        and ("supplier_invoices"."match_approved_at" is null) = ("supplier_invoices"."match_approval_reason" is null)
        and ("supplier_invoices"."match_approved_status" is null or "supplier_invoices"."match_approved_status" in ('quantity_mismatch', 'price_mismatch', 'unmatched'))
        and ("supplier_invoices"."match_approval_reason" is null or char_length("supplier_invoices"."match_approval_reason") <= 500)
        and ("supplier_invoices"."match_approved_at" is null or "supplier_invoices"."purchase_order_id" is not null));--> statement-breakpoint
COMMENT ON TABLE "supplier_invoice_lines" IS 'Tedarikçi faturası kalemi (DOM-FIN-095; ON-277): siparişe bağlı faturada sipariş kalemine bağlı ya da siparişte olmayan satır; faturalanan miktar ve KDV hariç birim fiyat. Üçlü eşleştirme (sipariş, mal kabul, fatura) bu satırlardan her okumada hesaplanır, sonuç saklanmaz. Fatura girişiyle yazılır, değişmez; düzeltme faturanın iptali ve yeniden girişidir.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."institution_id" IS 'Kurum (institutions); her indeksin ilk kolonu.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."id" IS 'Kalem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."invoice_id" IS 'Kalemin faturası (supplier_invoices, restrict); fatura siparişe bağlıdır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."position" IS 'Faturadaki sıra (0''dan); faturada tekil.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."order_item_id" IS 'Bağlı sipariş kalemi (purchase_order_items, restrict); faturanın siparişinin kalemi olmalıdır (servis denetler) ve faturada bir kez geçer. Boşsa kalem siparişte yoktur ve eşleşmez.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."description" IS 'Siparişte olmayan kalemin adı (2–200 karakter); sipariş kalemine bağlı satırda boştur, ad sipariş kaleminden okunur.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."quantity" IS 'Faturalanan miktar (sipariş birimiyle tam sayı, 1–1.000.000). Önceki etkin faturalarla birlikte kabul edileni aşarsa miktar farkıdır (K-281).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."unit_price_cents" IS 'Faturadaki KDV hariç birim fiyat, kuruş. Sipariş fiyatından farkın kalem etkisi 1 TL''yi aşarsa fiyat farkıdır (K-281). Kalemlerin toplamı faturanın KDV hariç tutarından en çok 1 TL sapar (K-280).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."updated_at" IS 'Son değişiklik zamanı (UTC); kalem değişmez, oluşturma zamanına eşittir.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."archived_at" IS 'Arşiv zamanı; kalem arşivlenmez, fatura iptalinde de durur.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoice_lines"."version" IS 'Sürüm; kalem değişmediği için 1 kalır.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."match_approved_status" IS 'Gerekçeyle onaylanan eşleştirme sapması (quantity_mismatch, price_mismatch, unmatched; DOM-FIN-095, K-282). Onay yalnız bugünkü sapma bununla aynıysa geçerlidir; sapma değişirse ödeme yeniden onay ister. Onay yoksa boş.';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."match_approved_at" IS 'Fark onayının zamanı (UTC); yalnız siparişe bağlı faturada. Yeni onay öncekinin üzerine yazar, geçmişi denetim kaydındadır (supplier_invoice.approve_match).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."match_approved_by_user_id" IS 'Farkı onaylayan kullanıcı (yönetici).';--> statement-breakpoint
COMMENT ON COLUMN "supplier_invoices"."match_approval_reason" IS 'Fark onayının gerekçesi (5–500 karakter); serbest metin, loglanmaz, denetim kaydına yalnız alan adı düşer.';
