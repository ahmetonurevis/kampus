CREATE TABLE "bank_transactions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"statement_description" text NOT NULL,
	"counterparty_name" text,
	"bank_reference" text,
	"balance_cents" bigint,
	"fingerprint" text NOT NULL,
	"source_format" text NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"source_line" integer NOT NULL,
	"imported_by_user_id" text NOT NULL,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"payment_id" uuid,
	"matched_at" timestamp with time zone,
	"matched_by_user_id" text,
	"ignored_at" timestamp with time zone,
	"ignored_by_user_id" text,
	"ignore_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bank_transactions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "bank_transactions_amount_check" CHECK ("bank_transactions"."amount_cents" > 0),
	CONSTRAINT "bank_transactions_currency_check" CHECK ("bank_transactions"."currency" = 'TRY'),
	CONSTRAINT "bank_transactions_description_check" CHECK (char_length("bank_transactions"."statement_description") <= 1000),
	CONSTRAINT "bank_transactions_fingerprint_check" CHECK ("bank_transactions"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bank_transactions_source_format_check" CHECK ("bank_transactions"."source_format" in ('csv', 'mt940')),
	CONSTRAINT "bank_transactions_status_check" CHECK ("bank_transactions"."status" in ('unmatched', 'matched', 'ignored')),
	CONSTRAINT "bank_transactions_lifecycle_check" CHECK (("bank_transactions"."status" = 'unmatched' and "bank_transactions"."payment_id" is null and "bank_transactions"."matched_at" is null and "bank_transactions"."matched_by_user_id" is null and "bank_transactions"."ignored_at" is null and "bank_transactions"."ignored_by_user_id" is null and "bank_transactions"."ignore_reason" is null)
        or ("bank_transactions"."status" = 'matched' and "bank_transactions"."payment_id" is not null and "bank_transactions"."matched_at" is not null and "bank_transactions"."matched_by_user_id" is not null and "bank_transactions"."ignored_at" is null and "bank_transactions"."ignore_reason" is null)
        or ("bank_transactions"."status" = 'ignored' and "bank_transactions"."payment_id" is null and "bank_transactions"."ignored_at" is not null and "bank_transactions"."ignored_by_user_id" is not null and "bank_transactions"."ignore_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_fkey" FOREIGN KEY ("institution_id","bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_payment_fkey" FOREIGN KEY ("institution_id","payment_id") REFERENCES "public"."payments"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_fingerprint_key" ON "bank_transactions" USING btree ("institution_id","bank_account_id","fingerprint") WHERE "bank_transactions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_payment_key" ON "bank_transactions" USING btree ("institution_id","payment_id") WHERE "bank_transactions"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_transactions_status_date_idx" ON "bank_transactions" USING btree ("institution_id","status","booking_date");--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "bank_transactions" IS 'Banka ekstresinden aktarılan gelen hareket (IST-115, ON-099, DOM-FIN-069). Dosya saklanmaz, yalnız gelen (alacak) hareket yazılır (K-106). Tutar, gün, açıklama ve referans değişmez; durum unmatched → matched (onayla aynı işlemde tahsilat yazılır) ya da ignored. Eşleşme tahsilat iptaliyle geri açılır (K-111).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."id" IS 'Hareket kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."bank_account_id" IS 'Hareketin ait olduğu kurum banka hesabı (bank_accounts, DOM-FIN-032); içe aktarımda seçilir, onaydaki tahsilat bu hesaba bağlanır.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."booking_date" IS 'Ekstredeki işlem günü (valör değil, K-109); onaydaki tahsilatın ödeme günü. Kapalı güne tahsilat yazılmaz (DOM-FIN-036).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."amount_cents" IS 'Gelen tutar, kuruş, sıfırdan büyük. Onayda bölünmeden tahsilat tutarı olur (K-110).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."statement_description" IS 'Ekstre açıklaması, en çok 1000 karakter. Kişisel veri (ad, kimlik no, IBAN) içerebilir: loglanmaz, yanıtta 11 ve daha uzun rakam dizileri son dört hane dışında maskelenir (K-112).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."counterparty_name" IS 'Ekstrede ayrı sütunsa gönderen ya da karşı taraf adı; eşleştirmede açıklamayla birlikte okunur.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."bank_reference" IS 'Bankanın işlem ya da dekont referansı; onayda tahsilatın referansı olur, yoksa parmak izinden EKSTRE-… kurulur (K-109).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."balance_cents" IS 'Ekstredeki hareket sonrası bakiye, kuruş; MT940''ta ve bakiyesiz dökümde boş. Yalnız bilgi içindir.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."fingerprint" IS 'Mükerrer izi: hesap + gün + tutar + katlanmış açıklama + referans + dosyadaki sıra anahtarının sha256 özeti (K-107). Hesapta tekil; aynı hareket ikinci kez aktarılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."source_format" IS 'Dosya biçimi: csv (Excel dahil) ya da mt940.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."import_batch_id" IS 'Aynı yüklemede yazılan hareketlerin ortak kimliği; denetim kaydının varlık kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."source_line" IS 'Hareketin dosyadaki satırı (bilgi; dosya saklanmaz).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."imported_by_user_id" IS 'Ekstreyi yükleyen kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."status" IS 'unmatched (eşleşmedi), matched (tahsilatla eşleşti), ignored (gerekçeyle yoksayıldı).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."payment_id" IS 'Onayla oluşan tahsilat (payments); yalnız matched durumda dolu, bir tahsilat tek harekete bağlanır. Tahsilat iptal edilince boşalır, durum unmatched olur.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."matched_at" IS 'Onay anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."matched_by_user_id" IS 'Öneriyi onaylayan kullanıcı (BANK_MATCH_ROLES).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."ignored_at" IS 'Yoksayma anı (UTC); geri alınınca boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."ignored_by_user_id" IS 'Hareketi yoksayan kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."ignore_reason" IS 'Yoksayma gerekçesi, 3–200 karakter serbest metin; loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."created_at" IS 'İçe aktarım anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."updated_at" IS 'Son durum değişikliği (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."archived_at" IS 'Arşiv anı; bugün kullanılmaz (hareket silinmez).';--> statement-breakpoint
COMMENT ON COLUMN "bank_transactions"."version" IS 'İyimser kilit sürümü; eşleştirme, yoksayma ve geri alma If-Match ile bu sürümü ister.';
