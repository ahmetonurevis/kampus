CREATE TABLE "stock_count_entries" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer,
	"entered_at" timestamp with time zone NOT NULL,
	"entered_by_user_id" text NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_count_entries_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "stock_count_entries_kind_check" CHECK ("stock_count_entries"."kind" in ('scan', 'set')),
	CONSTRAINT "stock_count_entries_quantity_check" CHECK (("stock_count_entries"."kind" = 'scan' and "stock_count_entries"."quantity" between 1 and 1000000)
        or ("stock_count_entries"."kind" = 'set' and ("stock_count_entries"."quantity" is null or "stock_count_entries"."quantity" between 0 and 1000000) and "stock_count_entries"."undone_at" is null)),
	CONSTRAINT "stock_count_entries_undo_check" CHECK (("stock_count_entries"."undone_at" is null) = ("stock_count_entries"."undone_by_user_id" is null))
);
--> statement-breakpoint
DROP INDEX "fixed_asset_count_items_asset_key";--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_count_fkey" FOREIGN KEY ("institution_id","count_id") REFERENCES "public"."stock_counts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."stock_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_entries_sequence_key" ON "stock_count_entries" USING btree ("institution_id","count_id","sequence");--> statement-breakpoint
CREATE INDEX "stock_count_entries_count_item_idx" ON "stock_count_entries" USING btree ("institution_id","count_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_count_entries_item_idx" ON "stock_count_entries" USING btree ("institution_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_barcode_key" ON "stock_items" USING btree ("institution_id","barcode") WHERE "stock_items"."barcode" is not null and "stock_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_count_items_asset_key" ON "fixed_asset_count_items" USING btree ("institution_id","count_id","asset_id") WHERE "fixed_asset_count_items"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_barcode_check" CHECK ("stock_items"."barcode" is null or "stock_items"."barcode" ~ '^[A-Z0-9][A-Z0-9._/+-]{0,39}$');--> statement-breakpoint
-- Açık sayımlarda daha önce sayılmış satırlar elle giriş olarak geçmişe yazılır; geri alma satırın miktarını girişlerden yeniden hesapladığı için geçmiş eksiksiz başlar (K-285).
INSERT INTO "stock_count_entries" ("institution_id", "id", "count_id", "item_id", "sequence", "kind", "quantity", "entered_at", "entered_by_user_id", "created_at", "updated_at")
SELECT l."institution_id", gen_random_uuid(), l."count_id", l."item_id",
  row_number() OVER (PARTITION BY l."institution_id", l."count_id" ORDER BY l."counted_at", l."id")::integer,
  'set', l."counted_quantity", l."counted_at", l."counted_by_user_id", now(), now()
FROM "stock_count_lines" l
JOIN "stock_counts" c ON c."institution_id" = l."institution_id" AND c."id" = l."count_id"
WHERE c."status" = 'open' AND c."archived_at" IS NULL AND l."archived_at" IS NULL AND l."counted_quantity" IS NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "stock_items"."barcode" IS 'Ürünün barkodu (DOM-FIN-077, K-284): isteğe bağlı; boşluksuz, büyük harf. 8 ya da 13 haneli sayısal kod EAN sayılır ve sağlama basamağı uygulamada denetlenir; öteki kodlar serbesttir. Kurumda tekil (arşivli hariç, stock_items_barcode_key) ve başka kartın koduyla aynı olamaz. Stok sayımında okunan kod önce barkodla, sonra kart koduyla eşleşir (K-229).';--> statement-breakpoint
COMMENT ON TABLE "stock_count_entries" IS 'Stok sayımı girişi (DOM-FIN-081, ON-340, K-285): açık sayımdaki her okutma (scan, eklenen miktar) ve elle yazılan miktar (set, satırın yeni miktarı) sırayla yazılır. Okutma geri alınabilir; stock_count_lines satırının sayılan miktarı ve son sayım anı geri alınmamış girişlerin sırayla uygulanmasından yeniden hesaplanır. Giriş silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."id" IS 'Giriş kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."count_id" IS 'Sayım (stock_counts).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."item_id" IS 'Sayılan stok kartı (stock_items).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."sequence" IS 'Sayım içinde artan sıra (kurum kilidi altında verilir); girişler bu sırayla uygulanır, sayımda tekildir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."kind" IS 'Tür: scan (okutma; eklenen miktar), set (elle yazılan miktar; boşsa "sayılmadı"). Yalnız okutma geri alınır.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."quantity" IS 'Okutmada eklenen miktar (1–1.000.000); elle girişte satırın yeni miktarı (0–1.000.000) ya da boş ("sayılmadı").';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."entered_at" IS 'Girişin anı (UTC); geçerli son girişin anı satırın son sayım anıdır (K-231).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."entered_by_user_id" IS 'Girişi yapan kullanıcı (Better Auth kimliği; kişisel veri, K sınıfı).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."undone_at" IS 'Okutmanın geri alındığı an; boşsa geçerli. Elle girişte hep boş. Okutmadan sonra aynı kartın miktarı elle yazıldıysa okutma geri alınmaz.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."undone_by_user_id" IS 'Okutmayı geri alan kullanıcı (kişisel veri, K sınıfı); undone_at ile birlikte dolar.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."updated_at" IS 'Son değişiklik anı (geri alma).';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."archived_at" IS 'Arşiv anı; giriş arşivlenmez, sütun ortak düzen içindir.';--> statement-breakpoint
COMMENT ON COLUMN "stock_count_entries"."version" IS 'Kayıt sürümü; geri almada artar.';--> statement-breakpoint
COMMENT ON INDEX "fixed_asset_count_items_asset_key" IS 'Sayımda bir demirbaşın tek etkin satırı; geri alınan "listede yoktu" okutmasının satırı arşivlenir ve demirbaş yeniden okutulabilir (DOM-FIN-087, K-286).';
