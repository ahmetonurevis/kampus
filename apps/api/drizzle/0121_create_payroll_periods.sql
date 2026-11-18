CREATE TABLE "payroll_adjustments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"source_month" text NOT NULL,
	"target_month" text NOT NULL,
	"membership_id" text NOT NULL,
	"item" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_adjustments_item_check" CHECK ("payroll_adjustments"."item" in ('wage', 'lesson', 'benefit', 'deduction', 'other')),
	CONSTRAINT "payroll_adjustments_amount_check" CHECK ("payroll_adjustments"."amount_cents" <> 0
        and abs("payroll_adjustments"."amount_cents") <= 1000000000),
	CONSTRAINT "payroll_adjustments_currency_check" CHECK ("payroll_adjustments"."currency" = 'TRY'),
	CONSTRAINT "payroll_adjustments_months_check" CHECK ("payroll_adjustments"."source_month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$' and "payroll_adjustments"."target_month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'
        and "payroll_adjustments"."target_month" > "payroll_adjustments"."source_month"),
	CONSTRAINT "payroll_adjustments_reason_check" CHECK (char_length("payroll_adjustments"."reason") between 5 and 500),
	CONSTRAINT "payroll_adjustments_cancel_check" CHECK ((("payroll_adjustments"."archived_at" is null) = ("payroll_adjustments"."cancel_reason" is null))
        and (("payroll_adjustments"."archived_at" is null) = ("payroll_adjustments"."cancelled_by_user_id" is null))
        and ("payroll_adjustments"."cancel_reason" is null or char_length("payroll_adjustments"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"approval_count" integer DEFAULT 1 NOT NULL,
	"staff_count" integer NOT NULL,
	"rate_count" integer NOT NULL,
	"monthly_gross_total_cents" bigint NOT NULL,
	"adjustment_count" integer NOT NULL,
	"adjustment_total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"parameter_set_id" text,
	"parameter_effective_from" date,
	"inputs_hash" text NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_periods_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_periods_month_check" CHECK ("payroll_periods"."month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_periods_status_check" CHECK ("payroll_periods"."status" in ('approved', 'reopened')),
	CONSTRAINT "payroll_periods_counts_check" CHECK ("payroll_periods"."approval_count" >= 1 and "payroll_periods"."staff_count" >= 0 and "payroll_periods"."rate_count" >= 0
        and "payroll_periods"."monthly_gross_total_cents" >= 0 and "payroll_periods"."adjustment_count" >= 0),
	CONSTRAINT "payroll_periods_currency_check" CHECK ("payroll_periods"."currency" = 'TRY'),
	CONSTRAINT "payroll_periods_hash_check" CHECK ("payroll_periods"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payroll_periods_parameter_check" CHECK (("payroll_periods"."parameter_set_id" is null) = ("payroll_periods"."parameter_effective_from" is null)),
	CONSTRAINT "payroll_periods_reopen_check" CHECK ((("payroll_periods"."reopened_at" is null) = ("payroll_periods"."reopened_by_user_id" is null))
        and (("payroll_periods"."reopened_at" is null) = ("payroll_periods"."reopen_reason" is null))
        and ("payroll_periods"."status" <> 'reopened' or "payroll_periods"."reopened_at" is not null)
        and ("payroll_periods"."reopen_reason" is null or char_length("payroll_periods"."reopen_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."payroll_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_idx" ON "payroll_adjustments" USING btree ("institution_id","period_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_membership_idx" ON "payroll_adjustments" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_target_idx" ON "payroll_adjustments" USING btree ("institution_id","target_month") WHERE "payroll_adjustments"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_month_key" ON "payroll_periods" USING btree ("institution_id","month") WHERE "payroll_periods"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "payroll_periods" IS 'Bordro dönemi (DOM-FIN-108, ON-200, K-356…K-359): kurumun bir takvim ayı için bordro girdilerinin (ücret tanımları, bordro parametreleri, aya aktarılan düzeltmeler) onayı. Kaydı olmayan ay açıktır; approved ay kilitlidir ve o aya düşen ücret tanımı ile parametre seti yazmaları 409 payroll_period_locked olur; reopened ay gerekçeyle yeniden açılmıştır ve tekrar onaylanabilir. Onay anının girdi özeti ve SHA-256 damgası saklanır. Yalnız yönetici; bordro Kampüs''te hesaplanmaz (ON-193).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."id" IS 'Dönem kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."month" IS 'Bordro ayı (YYYY-AA, 2020-01…2099-12); kurumda ay başına tek kayıt.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."status" IS 'Durum: approved onaylı (kilitli), reopened yeniden açılmış (açık sayılır). Açık ayın kaydı yoktur.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."approved_at" IS 'Son onay anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."approved_by_user_id" IS 'Son onaylayan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."approval_count" IS 'Kaçıncı onay (yeniden açıp onaylamada artar); önceki onaylar denetim kaydındadır.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."staff_count" IS 'Onay anı özeti: ayda en az bir günü yürürlükte ücret tanımı olan personel sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."rate_count" IS 'Onay anı özeti: ayla kesişen, iptal edilmemiş ücret tanımı sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."monthly_gross_total_cents" IS 'Onay anı özeti: personel başına ayda son başlayan aylık brüt ana ücretin toplamı, kuruş. Kurum toplamıdır, kişi tutarı değildir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."adjustment_count" IS 'Onay anı özeti: bu aya aktarılan, iptal edilmemiş düzeltme kaydı sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."adjustment_total_cents" IS 'Onay anı özeti: bu aya aktarılan düzeltmelerin işaretli toplamı, kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."parameter_set_id" IS 'Onay anında ayın ilk günü geçerli bordro parametre seti (platform kimliği ya da payroll_parameter_sets.id); tablodan önceki ayda boş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."parameter_effective_from" IS 'Geçerli parametre setinin yürürlük başlangıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."inputs_hash" IS 'Girdi damgası: ayla kesişen tanımların, aya aktarılan düzeltmelerin ve geçerli parametre setinin sıralı değerlerinin SHA-256 özeti (onaltılık). Onay isteği kullanıcının gördüğü damgayı taşır; farklıysa 409 payroll_inputs_changed.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."reopened_at" IS 'Son yeniden açma anı (UTC); yeniden onayda kayıtta kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."reopened_by_user_id" IS 'Son yeniden açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."reopen_reason" IS 'Son yeniden açma gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."created_at" IS 'İlk onay anında kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."archived_at" IS 'Kullanılmaz (dönem arşivlenmez); kurum tablosu zorunlu kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_periods"."version" IS 'İyimser kilit sürümü (yeniden açmada If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "payroll_adjustments" IS 'Bordro düzeltme kaydı (DOM-FIN-108, ON-200, K-358): onaylı (kilitli) ayın farkı; personel, kalem, işaretli fark tutarı ve gerekçe. Asıl dönem değişmez; fark kaynak aydan sonraki ilk kilitsiz aya (target_month) aktarılacak bordro girdisidir. Düzeltilmez, gerekçeyle iptal (arşiv) edilir; hedef ay onaylandıysa iptal edilmez. Tutar kişisel veridir: yalnız yönetici okur, tutarlı okuma denetim kaydına yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."id" IS 'Düzeltme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."period_id" IS 'Düzeltilen onaylı dönem (payroll_periods); dönem silinmez: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."source_month" IS 'Düzeltilen (kilitli) ay, YYYY-AA.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."target_month" IS 'Farkın aktarılacağı ay: kaynak aydan sonraki ilk kilitsiz ay (kayıt anında hesaplanır). Bordro aktarımı (ON-202) bu ayın girdisi olarak okur.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."membership_id" IS 'Düzeltmenin yapıldığı personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro; ayrılmış olabilir). Üyelik silinirse geçmiş korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."item" IS 'Kalem: wage ana ücret, lesson ek ders, benefit yan hak, deduction kesinti, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."amount_cents" IS 'İşaretli fark, kuruş (sıfır değil, mutlak değeri en çok 10.000.000 ₺): artı personele ek ödeme, eksi fazla ödenenin geri alınması. Kişisel veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."reason" IS 'Düzeltme gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."created_by_user_id" IS 'Düzeltmeyi yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); yalnız iptal edilmiş (arşivli) kayıtta.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."cancelled_by_user_id" IS 'Düzeltmeyi iptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."archived_at" IS 'İptal anı; iptal edilen düzeltme aktarılmaz ve listelenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_adjustments"."version" IS 'İyimser kilit sürümü (iptalde If-Match).';
