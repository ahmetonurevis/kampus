CREATE TABLE "finance_day_closings" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"closing_date" date NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"method_totals" jsonb NOT NULL,
	"collected_count" integer NOT NULL,
	"collected_cents" bigint NOT NULL,
	"reversed_count" integer NOT NULL,
	"reversed_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"opening_cash_cents" bigint,
	"counted_cash_cents" bigint,
	"expected_cash_cents" bigint,
	"cash_difference_cents" bigint,
	"note" text,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by_user_id" text NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "finance_day_closings_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "finance_day_closings_currency_check" CHECK ("finance_day_closings"."currency" = 'TRY'),
	CONSTRAINT "finance_day_closings_net_check" CHECK ("finance_day_closings"."net_cents" = "finance_day_closings"."collected_cents" - "finance_day_closings"."reversed_cents"),
	CONSTRAINT "finance_day_closings_cash_check" CHECK (("finance_day_closings"."counted_cash_cents" is null and "finance_day_closings"."opening_cash_cents" is null and "finance_day_closings"."expected_cash_cents" is null and "finance_day_closings"."cash_difference_cents" is null) or ("finance_day_closings"."counted_cash_cents" is not null and "finance_day_closings"."opening_cash_cents" is not null and "finance_day_closings"."expected_cash_cents" is not null and "finance_day_closings"."cash_difference_cents" = "finance_day_closings"."counted_cash_cents" - "finance_day_closings"."expected_cash_cents")),
	CONSTRAINT "finance_day_closings_reopen_check" CHECK (("finance_day_closings"."reopened_at" is null and "finance_day_closings"."reopened_by_user_id" is null and "finance_day_closings"."reopen_reason" is null) or ("finance_day_closings"."reopened_at" is not null and "finance_day_closings"."reopened_by_user_id" is not null and "finance_day_closings"."reopen_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "finance_day_closings" ADD CONSTRAINT "finance_day_closings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_day_closings_closing_date_key" ON "finance_day_closings" USING btree ("institution_id","closing_date") WHERE "finance_day_closings"."reopened_at" is null;--> statement-breakpoint
CREATE INDEX "finance_day_closings_closing_date_idx" ON "finance_day_closings" USING btree ("institution_id","closing_date","closed_at");--> statement-breakpoint
-- Kapatılmış gün değişmez (IST-113, DOM-FIN-036). `kampus_reject_immutable_change()` burada yetmez:
-- bir tek güncelleme meşrudur, yöneticinin gerekçeli yeniden açması. O da yalnız yeniden açma
-- kolonlarını doldurur; özet, kasa ve kapatan kişi değişmez, açılmış kapanış bir daha güncellenmez.
-- İmha istisnası yoktur: saklama süresi kararı verilmedi (M-07 doğrulanmalı).
CREATE FUNCTION "kampus_protect_finance_day_closing"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."reopened_at" IS NULL
    AND NEW."reopened_at" IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['reopened_at', 'reopened_by_user_id', 'reopen_reason', 'updated_at', 'version'])
      = (to_jsonb(OLD) - ARRAY['reopened_at', 'reopened_by_user_id', 'reopen_reason', 'updated_at', 'version'])
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: % rows are immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "finance_day_closings_immutable_trigger" BEFORE UPDATE OR DELETE ON "finance_day_closings" FOR EACH ROW EXECUTE FUNCTION "kampus_protect_finance_day_closing"();--> statement-breakpoint
CREATE TRIGGER "finance_day_closings_truncate_trigger" BEFORE TRUNCATE ON "finance_day_closings" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_protect_finance_day_closing"();--> statement-breakpoint
COMMENT ON TABLE "finance_day_closings" IS 'Gün kapanışı (IST-113, DOM-FIN-036): kapanış anının yöntem özeti, kasa sayımı, kim ve ne zaman. Satır silinmez; yeniden açma aynı satıra yazılır, yeni kapanış yeni satırdır.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."id" IS 'Kapanış kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."closing_date" IS 'Kapatılan gün (Europe/Istanbul). Gün başına en çok bir geçerli kapanış (reopened_at boş).';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."method_totals" IS 'Yöntem bazında özet: payments.method anahtarı, tahsilat ve iptal adedi ile kuruş tutarı, net.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."collected_count" IS 'O gün ödeme tarihli tahsilat adedi.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."collected_cents" IS 'O gün ödeme tarihli tahsilat toplamı (kuruş); sonradan iptal edilse de düşmez.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."reversed_count" IS 'O gün yapılan iptal adedi; tahsilatın günü başka olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."reversed_cents" IS 'O gün yapılan iptallerin toplamı (kuruş).';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."net_cents" IS 'Tahsilat eksi iptal (kuruş); kısıtla eşitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."opening_cash_cents" IS 'Açılış kasası (kuruş); sayım yoksa boş. Önceki kapanıştan farklıysa açıklama zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."counted_cash_cents" IS 'Görevlinin saydığı nakit (kuruş); nakit kapalı ve hareketsiz günde boş olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."expected_cash_cents" IS 'Açılış artı günün net nakdi (kuruş); iptal edilen nakit kasadan çıkmış sayılır, eksi olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."cash_difference_cents" IS 'Sayılan eksi beklenen (kuruş); artı fazla, eksi eksik. Sıfır değilse açıklama zorunludur.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."note" IS 'Kapatanın açıklaması (kasa farkı, açılış farkı). Serbest metin; loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."closed_at" IS 'Kapanış anı.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."closed_by_user_id" IS 'Kapatan kullanıcı (yönetici ya da ön büro).';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."reopened_at" IS 'Yeniden açılma anı; boşsa kapanış geçerlidir ve gün kapalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."reopened_by_user_id" IS 'Yeniden açan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."reopen_reason" IS 'Yeniden açma gerekçesi. Serbest metin; loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."created_at" IS 'Oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."updated_at" IS 'Son değişiklik anı (yalnız yeniden açmada).';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."archived_at" IS 'Zorunlu kolon; kapanış arşivlenmez, her zaman boştur.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."version" IS 'İyimser kilit sürümü (If-Match); yeniden açmada artar.';
