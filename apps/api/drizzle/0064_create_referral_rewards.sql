CREATE TABLE "referral_rewards" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"prospect_id" text NOT NULL,
	"referrer_student_id" text NOT NULL,
	"referrer_parent_id" text NOT NULL,
	"referred_student_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"tariff_id" text NOT NULL,
	"percent_basis_points" integer,
	"amount_cents" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"earned_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_contract_id" text,
	"used_student_id" text,
	"used_amount_cents" bigint,
	"used_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "referral_rewards_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "referral_rewards_status_check" CHECK ("referral_rewards"."status" in ('pending', 'available', 'used', 'cancelled')),
	CONSTRAINT "referral_rewards_cancel_reason_check" CHECK ("referral_rewards"."cancel_reason" is null or "referral_rewards"."cancel_reason" in ('refunded_before_start', 'withdrawn_before_earned')),
	CONSTRAINT "referral_rewards_value_check" CHECK (("referral_rewards"."percent_basis_points" is null) <> ("referral_rewards"."amount_cents" is null)),
	CONSTRAINT "referral_rewards_used_check" CHECK (("referral_rewards"."status" = 'used') = ("referral_rewards"."used_contract_id" is not null)),
	CONSTRAINT "referral_rewards_cancelled_check" CHECK (("referral_rewards"."status" = 'cancelled') = ("referral_rewards"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_prospect_key" ON "referral_rewards" USING btree ("institution_id","prospect_id") WHERE "referral_rewards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "referral_rewards_referrer_parent_idx" ON "referral_rewards" USING btree ("institution_id","referrer_parent_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_referrer_student_idx" ON "referral_rewards" USING btree ("institution_id","referrer_student_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_referred_student_idx" ON "referral_rewards" USING btree ("institution_id","referred_student_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_used_contract_idx" ON "referral_rewards" USING btree ("institution_id","used_contract_id");--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "referral_rewards" IS 'Referans indirimi hakkı (DOM-FIN-024). Kesin kayıtta açılır, ilk taksit ödenince doğar, sonraki sözleşmede bir kez kullanılır. Nakit ya da para iadesi karşılığı yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."id" IS 'Hak kimliği; bildirimde yalnız bu taşınır.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."prospect_id" IS 'Referansla gelen aday; bir aday yalnız bir referansa bağlanır. Aileye gösterilmez.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."referrer_student_id" IS 'Adayın kaynağına bağlanan referans veren öğrenci (DOM-KAY-007); bildirim kitlesi.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."referrer_parent_id" IS 'Hakkın sahibi veli; kullanım yalnız bu velinin sözleşmesindedir.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."referred_student_id" IS 'Kesin kayıtla oluşan öğrenci; ilk taksiti hakkı doğurur, öğretim başlamadan iadesi iptal eder. Aileye gösterilmez.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."academic_year" IS 'Referansla gelen kaydın eğitim yılı (başlangıç yılı).';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."tariff_id" IS 'Oranın ya da tutarın kopyalandığı tarife.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."percent_basis_points" IS 'Kayıt yılı tarifesindeki oran, on binde birlik; amount_cents ile birlikte dolmaz.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."amount_cents" IS 'Kayıt yılı tarifesindeki tutar, kuruş; uygulanan tutar used_amount_cents.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."status" IS 'pending: ilk taksit bekleniyor; available: kullanılabilir; used: kullanıldı; cancelled: iptal.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."earned_at" IS 'İlk taksitin ödenmesiyle hakkın doğduğu an; tahsilat iptalinde boşalır.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."used_at" IS 'Hakkın sözleşmede kullanıldığı an.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."used_contract_id" IS 'Hakkın kullanıldığı sözleşme; used durumunda zorunlu.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."used_student_id" IS 'Hakkın kullanıldığı sözleşmenin öğrencisi.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."used_amount_cents" IS 'Sözleşmeye uygulanan tutar, kuruş; indirim tavanını aşan kısım düşer ve devretmez (DOM-FIN-021).';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."used_by_user_id" IS 'Sözleşmeyi işleyen görevli.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."cancelled_at" IS 'Hakkın iptal edildiği an.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."cancel_reason" IS 'refunded_before_start: öğretim başlamadan iade; withdrawn_before_earned: ilk taksit ödenmeden ayrılış. Aileye gösterilmez.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."archived_at" IS 'Arşiv anı; arşivli satır benzersizlik ve okumaya girmez.';--> statement-breakpoint
COMMENT ON COLUMN "referral_rewards"."version" IS 'Kayıt sürümü; her durum geçişinde artar.';
