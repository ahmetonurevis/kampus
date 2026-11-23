CREATE TABLE "purchase_receipt_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"accepted_quantity" integer NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_receipt_items_quantity_check" CHECK ("purchase_receipt_items"."accepted_quantity" between 0 and 1000000
        and "purchase_receipt_items"."rejected_quantity" between 0 and 1000000
        and "purchase_receipt_items"."accepted_quantity" + "purchase_receipt_items"."rejected_quantity" > 0),
	CONSTRAINT "purchase_receipt_items_reject_check" CHECK ((("purchase_receipt_items"."rejected_quantity" > 0) = ("purchase_receipt_items"."reject_reason" is not null))
        and ("purchase_receipt_items"."reject_reason" is null or char_length("purchase_receipt_items"."reject_reason") <= 300))
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"received_by" text NOT NULL,
	"inspection_note" text,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "purchase_receipts_text_check" CHECK (char_length("purchase_receipts"."received_by") between 2 and 120
        and ("purchase_receipts"."inspection_note" is null or char_length("purchase_receipts"."inspection_note") <= 1000)
        and ("purchase_receipts"."cancel_reason" is null or char_length("purchase_receipts"."cancel_reason") <= 500)),
	CONSTRAINT "purchase_receipts_cancel_check" CHECK ((("purchase_receipts"."cancelled_at" is null) = ("purchase_receipts"."cancelled_by_user_id" is null))
        and (("purchase_receipts"."cancelled_at" is null) = ("purchase_receipts"."cancel_reason" is null)))
);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receipt_fkey" FOREIGN KEY ("institution_id","receipt_id") REFERENCES "public"."purchase_receipts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_order_item_fkey" FOREIGN KEY ("institution_id","order_item_id") REFERENCES "public"."purchase_order_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_fkey" FOREIGN KEY ("institution_id","order_id") REFERENCES "public"."purchase_orders"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_items_order_item_key" ON "purchase_receipt_items" USING btree ("institution_id","receipt_id","order_item_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_receipt_idx" ON "purchase_receipt_items" USING btree ("institution_id","receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_order_item_idx" ON "purchase_receipt_items" USING btree ("institution_id","order_item_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_order_idx" ON "purchase_receipts" USING btree ("institution_id","order_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_date_idx" ON "purchase_receipts" USING btree ("institution_id","receipt_date");--> statement-breakpoint
COMMENT ON TABLE "purchase_receipts" IS 'Mal kabul (DOM-FIN-074, ON-226): gönderilmiş ya da kısmen teslim alınmış siparişin bir teslimatı. Bir siparişe birden çok kısmi kabul yapılır; sipariş durumu iptal edilmemiş kabullerde kabul edilen toplamdan türetilir (K-150). Silinmez, yönetici gerekçeyle iptal eder (K-153). Kabul edilen miktar × sipariş birim fiyatı (KDV hariç) kabul gününde gider gerçekleşenidir (DOM-FIN-066, K-151).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."id" IS 'Kabul kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."order_id" IS 'Teslim alınan sipariş (purchase_orders).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."receipt_date" IS 'Kabul günü (Europe/Istanbul); sipariş açılış gününden önce, bugünden sonra olamaz, kapalı bütçe dönemine düşemez. Gider gerçekleşeninin tahakkuk günüdür.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."received_by" IS 'Teslim alan personelin adı, 2–120 karakter; serbest metin, sistem kullanıcısı olmayabilir (K-152). Kişisel veri, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."inspection_note" IS 'İsteğe bağlı muayene notu, en çok 1000 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."created_by_user_id" IS 'Kabulü kaydeden kullanıcı (yönetici ya da ön büro).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."cancelled_at" IS 'Kabul iptali zamanı; iptal edilen kabul durum ve gerçekleşen hesabına girmez.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."cancelled_by_user_id" IS 'Kabulü iptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."archived_at" IS 'Arşiv zamanı; bugün kabul arşivlenmez, iptal edilir.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipts"."version" IS 'İyimser kilit sürümü (If-Match; kabul iptali).';--> statement-breakpoint
COMMENT ON TABLE "purchase_receipt_items" IS 'Mal kabul kalemi (DOM-FIN-074): sipariş kalemine kabul edilen ve reddedilen miktar. Kalemde iptal edilmemiş kabullerin kabul edilen toplamı sipariş miktarını aşamaz (kurum kilidi altında denetlenir, K-150). Yazıldıktan sonra değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."id" IS 'Kabul kalemi kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."receipt_id" IS 'Kabul (purchase_receipts).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."order_item_id" IS 'Sipariş kalemi (purchase_order_items); kabulde kalem başına bir satır.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."accepted_quantity" IS 'Kabul edilen miktar; siparişi karşılar ve KDV hariç birim fiyatla gider gerçekleşeni olur.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."rejected_quantity" IS 'Muayenede reddedilen miktar; karşılanmış sayılmaz, tedarikçi yeniden gönderir (K-150). Kabul ve ret toplamı sıfırdan büyüktür.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."reject_reason" IS 'Ret nedeni, 3–300 karakter; yalnız reddedilen miktar varken ve o zaman zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."archived_at" IS 'Arşiv zamanı; bugün kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "purchase_receipt_items"."version" IS 'Satır sürümü.';
