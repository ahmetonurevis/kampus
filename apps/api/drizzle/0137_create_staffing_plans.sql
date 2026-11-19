CREATE TABLE "staffing_plans" (
	"institution_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"norm_hours" integer NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staffing_plans_pkey" PRIMARY KEY("institution_id","academic_year"),
	CONSTRAINT "staffing_plans_year_check" CHECK ("staffing_plans"."academic_year" between 2000 and 2100),
	CONSTRAINT "staffing_plans_norm_check" CHECK ("staffing_plans"."norm_hours" between 1 and 40),
	CONSTRAINT "staffing_plans_lines_check" CHECK (jsonb_typeof("staffing_plans"."lines") = 'array' and jsonb_array_length("staffing_plans"."lines") <= 80)
);
--> statement-breakpoint
CREATE TABLE "staffing_positions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"subject_id" text NOT NULL,
	"hours" integer NOT NULL,
	"status" text NOT NULL,
	"job_offer_id" uuid,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staffing_positions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staffing_positions_status_check" CHECK ("staffing_positions"."status" in ('open', 'posted', 'filled', 'cancelled')),
	CONSTRAINT "staffing_positions_year_check" CHECK ("staffing_positions"."academic_year" between 2000 and 2100),
	CONSTRAINT "staffing_positions_hours_check" CHECK ("staffing_positions"."hours" between 1 and 60),
	CONSTRAINT "staffing_positions_text_check" CHECK (char_length("staffing_positions"."subject_id") between 1 and 40
        and ("staffing_positions"."note" is null or char_length("staffing_positions"."note") between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "staffing_plans" ADD CONSTRAINT "staffing_plans_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_positions" ADD CONSTRAINT "staffing_positions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_positions" ADD CONSTRAINT "staffing_positions_job_offer_fkey" FOREIGN KEY ("institution_id","job_offer_id") REFERENCES "public"."staff_job_offers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staffing_positions_year_idx" ON "staffing_positions" USING btree ("institution_id","academic_year");--> statement-breakpoint
CREATE INDEX "staffing_positions_job_offer_idx" ON "staffing_positions" USING btree ("institution_id","job_offer_id");--> statement-breakpoint
COMMENT ON TABLE "staffing_plans" IS 'Kadro planı (DOM-FIN-126, ON-188, K-433…K-435). Kurum ve eğitim yılı başına bir satır; satır yoksa varsayılan geçerlidir (norm 20, satır yok). Kapasite, açık ve öneri saklanmaz; okumada öğretmen kaydı, ücret tanımı ve ders programından hesaplanır. Yalnız yönetici yazar; If-Match sürümle.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."institution_id" IS 'Kurum (birincil anahtarın ilk kolonu).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."academic_year" IS 'Eğitim yılının başlangıç yılı (2026 = 2026-2027; academic_years.start_year ile aynı temsil).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."norm_hours" IS 'Norm: tam zamanlı öğretmen başına haftalık zorunlu ders saati (1–40, varsayılan 20). Kapasite = tam zamanlı öğretmen × norm; tam zamanlı eşdeğeri = saat / norm (K-434).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."lines" IS 'Branş satırları: [{subjectId, requiredHours}] dizisi; branş öğretmen kaydının dersi (K-421), haftalık ihtiyaç saati 0–2000, en çok 80 satır, aynı branş bir kez, branşa göre sıralı. Satırı olmayan branşta ihtiyaç ders programı önerisidir (K-433). Yazmadan önce core staffingPlanInputSchema ile doğrulanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."updated_by_user_id" IS 'Planı son kaydeden yönetici kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."created_at" IS 'Planın ilk kaydı.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."updated_at" IS 'Son değişiklik.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."archived_at" IS 'Kullanılmaz (plan silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_plans"."version" IS 'Plan sürümü (If-Match); satır yokken 1, ilk kayıt 2.';
--> statement-breakpoint
COMMENT ON TABLE "staffing_positions" IS 'Açık pozisyon (DOM-FIN-126, ON-188, K-435). Branş ve haftalık saat; durum open → posted → filled ya da cancelled (son durumlar değişmez). Açık ve ilandaki pozisyonların saati kadro açığından düşülür. İş teklifine isteğe bağlı bağ. Satır silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."institution_id" IS 'Kurum (birincil anahtarın ilk kolonu).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."id" IS 'Pozisyon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."academic_year" IS 'Eğitim yılının başlangıç yılı; pozisyon bu yılın kadro planında gösterilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."subject_id" IS 'Branş: ders kimliği (öğretmen kaydının subjectId alanıyla aynı değer; K-421).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."hours" IS 'Pozisyonun haftalık ders saati (1–60).';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."status" IS 'open açık, posted ilanda, filled dolduruldu, cancelled iptal. Yalnız open ve posted değişir; open ve posted saatleri açıktan düşülür.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."job_offer_id" IS 'İsteğe bağlı iş teklifi bağı (staff_job_offers, DOM-FIN-121); aynı kurumun teklifi olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."note" IS 'Serbest not (en çok 500 karakter); loglanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."created_by_user_id" IS 'Pozisyonu açan yönetici kullanıcısı.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."created_at" IS 'Pozisyonun açıldığı an.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."updated_at" IS 'Son değişiklik.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."archived_at" IS 'Kullanılmaz (pozisyon silinmez, iptal edilir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staffing_positions"."version" IS 'Pozisyon sürümü (If-Match).';
