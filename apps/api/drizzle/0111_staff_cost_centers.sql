CREATE TABLE "staff_cost_allocation_shares" (
	"institution_id" text NOT NULL,
	"allocation_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"share_basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_cost_allocation_shares_pkey" PRIMARY KEY("institution_id","allocation_id","cost_center_id"),
	CONSTRAINT "staff_cost_allocation_shares_share_check" CHECK ("staff_cost_allocation_shares"."share_basis_points" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "staff_cost_allocations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"start_month" date NOT NULL,
	"wage_hours" integer,
	"extra_lesson_hours" integer,
	"duty_hours" integer,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_cost_allocations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_cost_allocations_start_month_check" CHECK (extract(day from "staff_cost_allocations"."start_month") = 1 and "staff_cost_allocations"."start_month" between '2020-01-01' and '2099-12-01'),
	CONSTRAINT "staff_cost_allocations_hours_check" CHECK (("staff_cost_allocations"."wage_hours" is null or "staff_cost_allocations"."wage_hours" between 0 and 300)
        and ("staff_cost_allocations"."extra_lesson_hours" is null or "staff_cost_allocations"."extra_lesson_hours" between 0 and 300)
        and ("staff_cost_allocations"."duty_hours" is null or "staff_cost_allocations"."duty_hours" between 0 and 300)),
	CONSTRAINT "staff_cost_allocations_cancel_check" CHECK ((("staff_cost_allocations"."archived_at" is null) = ("staff_cost_allocations"."cancel_reason" is null))
        and (("staff_cost_allocations"."archived_at" is null) = ("staff_cost_allocations"."cancelled_by_user_id" is null))
        and ("staff_cost_allocations"."cancel_reason" is null or char_length("staff_cost_allocations"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_cost_allocation_shares" ADD CONSTRAINT "staff_cost_allocation_shares_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_cost_allocation_shares" ADD CONSTRAINT "staff_cost_allocation_shares_allocation_fkey" FOREIGN KEY ("institution_id","allocation_id") REFERENCES "public"."staff_cost_allocations"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_cost_allocation_shares" ADD CONSTRAINT "staff_cost_allocation_shares_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_cost_allocations" ADD CONSTRAINT "staff_cost_allocations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_cost_allocations" ADD CONSTRAINT "staff_cost_allocations_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_cost_allocation_shares_cost_center_idx" ON "staff_cost_allocation_shares" USING btree ("institution_id","cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_cost_allocations_month_key" ON "staff_cost_allocations" USING btree ("institution_id","membership_id","start_month") WHERE "staff_cost_allocations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_cost_allocations_membership_idx" ON "staff_cost_allocations" USING btree ("institution_id","membership_id","start_month");--> statement-breakpoint
COMMENT ON TABLE "staff_cost_allocations" IS 'Personelin maliyet merkezi ataması (DOM-FIN-104, ON-204, K-332): bir personel üyeliğine ay başından yürürlüğe giren merkez payları (staff_cost_allocation_shares, toplam %100) ve saatli ücretlerin tahmini aylık saatleri. Atama personelin sonraki atamasının başlangıç ayına kadar sürer; bitiş saklanmaz. Personelde aynı ay için iptal edilmemiş tek atama olur. Düzeltilmez, gerekçeyle iptal (arşiv) edilir. Ücret tutarı taşımaz; tahmini personel maliyeti raporu ücret tanımı ve bordro parametrelerinden hesaplanır, saklanmaz. Yalnız yönetici okur ve yazar (K-334).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."id" IS 'Atama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."membership_id" IS 'Atanan personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse geçmiş korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."start_month" IS 'Yürürlük başlangıç ayının ilk günü (2020–2099). Atama sonraki atamanın başlangıç ayına kadar sürer.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."wage_hours" IS 'Saatlik ya da ders saati ücretli ana ücretin tahmini aylık saati (0–300); boşsa bu ana ücret rapora girmez ve uyarı verilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."extra_lesson_hours" IS 'Tahmini aylık ek ders saati (0–300); boşsa ek ders ücreti rapora girmez. Ek ders çizelgesi (ON-195) gelince gerçek saat kullanılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."duty_hours" IS 'Tahmini aylık nöbet saati (0–300); boşsa nöbet ücreti rapora girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."created_by_user_id" IS 'Atamayı yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); yalnız iptal edilen atamada dolu, denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."cancelled_by_user_id" IS 'Atamayı iptal eden kullanıcı; yalnız iptal edilen atamada dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."created_at" IS 'Kayıt zamanı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."updated_at" IS 'Son değişiklik zamanı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."archived_at" IS 'İptal zamanı (UTC); doluysa atama okunmaz ve aynı ay için yeni atama yazılabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocations"."version" IS 'İyimser kilit sürümü; iptal If-Match ile bu sürümü ister.';
--> statement-breakpoint
COMMENT ON TABLE "staff_cost_allocation_shares" IS 'Personel maliyet atamasının merkez payı (DOM-FIN-104, K-332): bir atamada bir maliyet merkezi bir kez geçer, paylar on binde birdir ve toplamı 10.000 (%100) olur (servis kurum kilidi altında denetler). Pay satırı atamayla birlikte yazılır ve değişmez; atama iptal edilince satır yerinde kalır, okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."allocation_id" IS 'Payın ait olduğu atama (staff_cost_allocations; restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."cost_center_id" IS 'Maliyet merkezi (cost_centers; restrict). Atama yazılırken etkin olmalıdır; sonradan pasifleşen merkez raporda kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."share_basis_points" IS 'Pay, on binde bir (1–10.000; 6000 = %60). Personelin aylık tahmini maliyeti bu payla bölünür, kalan kuruş en büyük kesre gider.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."created_at" IS 'Kayıt zamanı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."updated_at" IS 'Son değişiklik zamanı (UTC); pay satırı değişmediği için kayıt zamanına eşittir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."archived_at" IS 'Kullanılmaz (pay satırı atamayla birlikte iptal sayılır); ortak kolon kuralı gereği bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_cost_allocation_shares"."version" IS 'Sürüm; pay satırı değişmediği için 1 kalır.';
