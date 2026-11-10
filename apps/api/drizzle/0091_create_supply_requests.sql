CREATE TABLE "supply_request_issues" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supply_request_issues_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
CREATE TABLE "supply_request_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supply_request_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supply_request_items_position_check" CHECK ("supply_request_items"."position" >= 0),
	CONSTRAINT "supply_request_items_quantity_check" CHECK ("supply_request_items"."quantity" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "supply_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"needed_date" date NOT NULL,
	"justification" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decision_note" text,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by_user_id" text,
	"fulfillment_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"purchase_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supply_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "supply_requests_sequence_check" CHECK ("supply_requests"."sequence" >= 1),
	CONSTRAINT "supply_requests_status_check" CHECK ("supply_requests"."status" in ('submitted', 'approved', 'rejected', 'fulfilled', 'cancelled')),
	CONSTRAINT "supply_requests_text_check" CHECK (char_length("supply_requests"."justification") between 5 and 1000
        and ("supply_requests"."decision_note" is null or char_length("supply_requests"."decision_note") <= 500)
        and ("supply_requests"."fulfillment_note" is null or char_length("supply_requests"."fulfillment_note") <= 500)
        and ("supply_requests"."cancel_reason" is null or char_length("supply_requests"."cancel_reason") <= 500)),
	CONSTRAINT "supply_requests_lifecycle_check" CHECK (("supply_requests"."status" = 'submitted' and "supply_requests"."decided_at" is null and "supply_requests"."fulfilled_at" is null and "supply_requests"."cancelled_at" is null)
        or ("supply_requests"."status" = 'approved' and "supply_requests"."decided_at" is not null and "supply_requests"."decided_by_user_id" is not null and "supply_requests"."fulfilled_at" is null and "supply_requests"."cancelled_at" is null)
        or ("supply_requests"."status" = 'rejected' and "supply_requests"."decided_at" is not null and "supply_requests"."decided_by_user_id" is not null and "supply_requests"."decision_note" is not null and "supply_requests"."fulfilled_at" is null and "supply_requests"."cancelled_at" is null)
        or ("supply_requests"."status" = 'fulfilled' and "supply_requests"."decided_at" is not null and "supply_requests"."fulfilled_at" is not null and "supply_requests"."fulfilled_by_user_id" is not null and "supply_requests"."cancelled_at" is null)
        or ("supply_requests"."status" = 'cancelled' and "supply_requests"."decided_at" is null and "supply_requests"."fulfilled_at" is null and "supply_requests"."cancelled_at" is not null and "supply_requests"."cancelled_by_user_id" is not null and "supply_requests"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";--> statement-breakpoint
ALTER TABLE "supply_request_issues" ADD CONSTRAINT "supply_request_issues_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_issues" ADD CONSTRAINT "supply_request_issues_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."supply_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_issues" ADD CONSTRAINT "supply_request_issues_item_fkey" FOREIGN KEY ("institution_id","request_item_id") REFERENCES "public"."supply_request_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_issues" ADD CONSTRAINT "supply_request_issues_movement_fkey" FOREIGN KEY ("institution_id","stock_movement_id") REFERENCES "public"."stock_movements"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."supply_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_stock_item_fkey" FOREIGN KEY ("institution_id","stock_item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_purchase_request_fkey" FOREIGN KEY ("institution_id","purchase_request_id") REFERENCES "public"."purchase_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_request_issues_request_idx" ON "supply_request_issues" USING btree ("institution_id","request_id");--> statement-breakpoint
CREATE INDEX "supply_request_issues_item_idx" ON "supply_request_issues" USING btree ("institution_id","request_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_request_issues_movement_key" ON "supply_request_issues" USING btree ("institution_id","stock_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_request_items_position_key" ON "supply_request_items" USING btree ("institution_id","request_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_request_items_stock_item_key" ON "supply_request_items" USING btree ("institution_id","request_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "supply_request_items_stock_item_idx" ON "supply_request_items" USING btree ("institution_id","stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_requests_sequence_key" ON "supply_requests" USING btree ("institution_id","sequence");--> statement-breakpoint
CREATE INDEX "supply_requests_status_idx" ON "supply_requests" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "supply_requests_requested_by_idx" ON "supply_requests" USING btree ("institution_id","requested_by_user_id");--> statement-breakpoint
CREATE INDEX "supply_requests_purchase_request_idx" ON "supply_requests" USING btree ("institution_id","purchase_request_id") WHERE "supply_requests"."purchase_request_id" is not null;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('in', 'out', 'transfer_in', 'transfer_out', 'receipt', 'delivery', 'supply'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK (("stock_movements"."type" = 'in' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('opening', 'donation', 'count_surplus', 'returned', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'out' and "stock_movements"."reason" is not null and "stock_movements"."reason" in ('usage', 'damage', 'loss', 'count_shortage', 'other') and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" in ('transfer_in', 'transfer_out') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is not null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null)
        or ("stock_movements"."type" = 'receipt' and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is not null and "stock_movements"."receipt_item_id" is not null)
        or ("stock_movements"."type" in ('delivery', 'supply') and "stock_movements"."reason" is null and "stock_movements"."transfer_id" is null and "stock_movements"."receipt_id" is null and "stock_movements"."receipt_item_id" is null));--> statement-breakpoint
COMMENT ON TABLE "supply_requests" IS 'Sarf malzeme talebi (DOM-FIN-091, ON-233): kurum personelinin (öğretmen dahil) stok kartlarından istediği kırtasiye, laboratuvar ya da temizlik malzemesi. Durum submitted → approved/rejected; onaylı talep depodan karşılanınca (tam ya da kısmi kapatma) fulfilled; talep eden onaydan önce iptal eder (cancelled). Öğretmen yalnız kendi talebini görür, yönetici ve ön büro hepsini (K-244).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."institution_id" IS 'Kurum; bütün sorgular bu kolonla kapsanır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."id" IS 'Talep kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."sequence" IS 'Kurum içi sıra numarası (1, 2, …); kurum kilidi altında verilir, ekranda SM-0001 biçiminde gösterilir.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."status" IS 'Durum: submitted (onay bekliyor), approved (onaylandı, karşılanabilir), rejected (reddedildi), fulfilled (karşılandı; kısmi kapatılmış olabilir), cancelled (talep eden onaydan önce iptal etti). lifecycle_check iz kolonlarıyla tutarlılığı zorlar.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."requested_by_user_id" IS 'Talebi açan personel (Better Auth kullanıcı kimliği, kişisel veri K). Talep her zaman açan kişi adınadır; iptali yalnız o yapar.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."needed_date" IS 'Malzemenin istendiği gün (Europe/Istanbul takvim günü); açılışta bugünden önce ve bir yıldan sonra olamaz. Bilgi amaçlıdır, karşılamayı kısıtlamaz.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."justification" IS 'Talebin gerekçesi (ders, deney, etkinlik), 5–1000 karakter; satın almaya dönüşünce satın alma talebinin gerekçesine kopyalanır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."decided_at" IS 'Onay ya da ret zamanı (UTC); yalnız yönetici karar verir.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."decided_by_user_id" IS 'Onaylayan ya da reddeden yönetici (kişisel veri K).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."decision_note" IS 'Onay notu (isteğe bağlı) ya da ret gerekçesi (zorunlu, 5–500 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."fulfilled_at" IS 'Talebin karşılandı durumuna geçtiği zaman (son karşılama ya da kısmi kapatma, UTC). Ara karşılamalar supply_request_issues üzerinden izlenir.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."fulfilled_by_user_id" IS 'Talebi karşılandı durumuna geçiren yönetici ya da ön büro (kişisel veri K).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."fulfillment_note" IS 'Kısmi kapatma açıklaması (kalan varken kapatmada zorunlu, 5–500 karakter); tam karşılamada isteğe bağlı.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."cancelled_at" IS 'Talep edenin iptal zamanı (UTC); yalnız onaydan önce.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."cancelled_by_user_id" IS 'İptal eden; talebi açan kişidir (kişisel veri K).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."cancel_reason" IS 'İptal gerekçesi, 5–500 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."purchase_request_id" IS 'Kalanın dönüştürüldüğü satın alma talebi (purchase_requests, DOM-FIN-071, K-246); aynı kurumun talebi (bileşik yabancı anahtar). Bağlı talep reddedilir ya da iptal edilirse yeniden dönüştürmede yeni talebe işaret eder. Satın alma talebi silinmez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."created_at" IS 'Talebin açıldığı (gönderildiği) zaman, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."updated_at" IS 'Son değişiklik zamanı, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."archived_at" IS 'Arşiv zamanı; talep silinmez, arşivli kayıt sorgulara girmez.';--> statement-breakpoint
COMMENT ON COLUMN "supply_requests"."version" IS 'İyimser kilit sürümü (If-Match); her geçişte ve karşılamada artar.';--> statement-breakpoint
COMMENT ON TABLE "supply_request_items" IS 'Sarf talebi kalemi (DOM-FIN-091): stok kartı ve istenen miktar (kartın biriminde tam sayı). Bir kart talepte bir kez yer alır. Karşılanan miktar saklanmaz; supply_request_issues ile bağlı iptal edilmemiş supply çıkışlarından toplanır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."id" IS 'Kalem kimliği; karşılama gövdesinde (lines[].itemId) ve dönüştürmede (prices[].itemId) kullanılır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."request_id" IS 'Bağlı sarf talebi (supply_requests).';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."position" IS 'Kalemin talepteki sırası (0''dan başlar).';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."stock_item_id" IS 'İstenen stok kartı (stock_items, DOM-FIN-077); aynı kurumun kartı (bileşik yabancı anahtar), açılışta etkin olmalıdır. Satın almaya dönüşte kalem bu kartla bağlı taşınır (ON-339). Kart silinmez (restrict).';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."quantity" IS 'İstenen miktar, kartın biriminde 1–10.000.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."created_at" IS 'Kayıt zamanı, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."updated_at" IS 'Son değişiklik zamanı, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."archived_at" IS 'Arşiv zamanı; kalemler talep açıldıktan sonra değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_items"."version" IS 'Kayıt sürümü.';--> statement-breakpoint
COMMENT ON TABLE "supply_request_issues" IS 'Sarf talebi karşılaması (DOM-FIN-091, K-245): talep kalemi için yazılan supply türündeki stok çıkışı (stock_movements, DOM-FIN-078). Bir hareket bir kaleme bağlıdır; miktar, depo ve gün harekettedir. Çıkış hareket listesinden iptal edilmez; geri gelen malzeme elle "kullanımdan iade" girişiyle yazılır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."id" IS 'Karşılama satırı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."request_id" IS 'Bağlı sarf talebi (supply_requests); talebin karşılama geçmişi bu kolonla okunur.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."request_item_id" IS 'Karşılanan talep kalemi (supply_request_items); kalemin karşılanan miktarı bu kolondan toplanır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."stock_movement_id" IS 'Yazılan supply türündeki stok çıkışı (stock_movements); kurumda tekil, bir hareket bir karşılamadır.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."created_at" IS 'Karşılama zamanı, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."updated_at" IS 'Son değişiklik zamanı, UTC.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."archived_at" IS 'Arşiv zamanı; karşılama satırı değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "supply_request_issues"."version" IS 'Kayıt sürümü.';--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."type" IS 'Tür: in (elle giriş), out (çıkış), transfer_in ve transfer_out (depolar arası transferin iki bacağı), receipt (mal kabul girişi), delivery (materyal seti teslimi çıkışı, DOM-FIN-080; kaynağı material_delivery_items), supply (sarf talebi karşılama çıkışı, DOM-FIN-091; kaynağı supply_request_issues). in, transfer_in ve receipt miktarı artırır.';
