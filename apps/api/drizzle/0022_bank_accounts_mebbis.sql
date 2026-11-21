CREATE TABLE "bank_accounts" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"iban" text NOT NULL,
	"account_holder" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bank_accounts_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mebbis_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mebbis_recorded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_iban_key" ON "bank_accounts" USING btree ("institution_id","iban") WHERE "bank_accounts"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_fkey" FOREIGN KEY ("institution_id","bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_bank_account_idx" ON "payments" USING btree ("institution_id","bank_account_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mebbis_check" CHECK (("payments"."mebbis_recorded_at" is null) = ("payments"."mebbis_recorded_by_user_id" is null));--> statement-breakpoint
COMMENT ON TABLE "bank_accounts" IS 'Kurumun Bakanlığa bildirilmiş banka hesapları (DOM-FIN-032). Arşivlenen hesap yeni tahsilatta seçilmez, geçmiş tahsilat bağı korunur.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."id" IS 'Hesap kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."bank_name" IS 'Banka adı.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."iban" IS 'Kurum hesabının IBAN numarası; arşivlenmemiş satırlarda kurum içinde tekil.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."account_holder" IS 'Hesap sahibi.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."archived_at" IS 'Arşiv anı; doluysa hesap yeni tahsilatta seçilmez.';--> statement-breakpoint
COMMENT ON COLUMN "bank_accounts"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "payments"."bank_account_id" IS 'Tahsilatın yapıldığı bildirilmiş hesap; nakitte ve hesap tanımlanmamış kurumda boş.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."mebbis_recorded_at" IS 'Tahsilatın MEBBİS''e işlendiği an; kurum elle işaretler, MEBBİS bağlantısı yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."mebbis_recorded_by_user_id" IS 'MEBBİS işaretini koyan kullanıcı.';
