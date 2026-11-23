CREATE TABLE "campaign_codes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"cost_cents" bigint,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "campaign_codes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "campaign_codes_code_check" CHECK ("campaign_codes"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
	CONSTRAINT "campaign_codes_name_check" CHECK (char_length("campaign_codes"."name") between 2 and 120),
	CONSTRAINT "campaign_codes_channel_check" CHECK ("campaign_codes"."channel" in ('social_media', 'flyer', 'fair', 'referral', 'website', 'other')),
	CONSTRAINT "campaign_codes_dates_check" CHECK ("campaign_codes"."start_date" <= "campaign_codes"."end_date"),
	CONSTRAINT "campaign_codes_cost_check" CHECK ("campaign_codes"."cost_cents" is null or "campaign_codes"."cost_cents" between 0 and 10000000000),
	CONSTRAINT "campaign_codes_currency_check" CHECK ("campaign_codes"."currency" = 'TRY')
);
--> statement-breakpoint
ALTER TABLE "campaign_codes" ADD CONSTRAINT "campaign_codes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_codes_code_key" ON "campaign_codes" USING btree ("institution_id","code");--> statement-breakpoint
COMMENT ON TABLE "campaign_codes" IS 'Kampanya kodu (DOM-KAY-041, ON-134): kurumun tanıtım çalışmasına (sosyal medya ilanı, el ilanı, fuar…) verdiği kod. Aday açılırken kod girilirse aday kampanyaya bağlanır (records adayında campaignId ve campaignCode; adaylar records''ta olduğu için yabancı anahtar yok) ve kayıt hunisi kampanya başına kırılır. Yönetici ve ön büro yönetir; silme arşivdir (K-288…K-291).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."institution_id" IS 'Kurum; bütün sorgular bu kolonla kapsanır.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."id" IS 'Kampanya kimliği; adayın campaignId alanı buna işaret eder.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."code" IS 'Kampanya kodu: büyük harf, rakam ve tire, 3–20 karakter; kurumda arşivliler dahil tekil (campaign_codes_code_key) ve sonradan değişmez (K-288). Adres çubuğunda ?kampanya=KOD olarak taşınır.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."name" IS 'Kampanyanın görünen adı (2–120 karakter); düzeltilebilir.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."channel" IS 'Kanal: social_media, flyer (el ilanı), fair (fuar), referral, website, other. Aday formunda kaynak bu kanaldan önerilir, zorlanmaz (K-289).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."start_date" IS 'Kampanyanın ilk günü (Europe/Istanbul, dahil); kod bu günden önce adaya bağlanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."end_date" IS 'Kampanyanın son günü (Europe/Istanbul, dahil); başlangıçtan önce olamaz, bu günden sonra kod adaya bağlanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."cost_cents" IS 'Kampanyanın toplam maliyeti, kuruş (isteğe bağlı). Raporda aday başı ve kayıt başı maliyet buradan hesaplanır; rapor aralığı kampanyayı kısmen kapsıyorsa hesaplanmaz (K-290).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."is_active" IS 'Etkin mi; pasif kampanyanın kodu yeni adaya bağlanmaz, raporda kalır.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."created_by_user_id" IS 'Kampanyayı tanımlayan kullanıcı (Better Auth users.id).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."created_at" IS 'Kaydın oluşturulma anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."updated_at" IS 'Son değişiklik anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."archived_at" IS 'Arşivlenme anı; doluysa listede görünmez, kod yeni adaya bağlanmaz, adayı olan kampanya raporda kalır. Kod yeniden kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "campaign_codes"."version" IS 'İyimser kilit sürümü; If-Match ile karşılaştırılır.';
