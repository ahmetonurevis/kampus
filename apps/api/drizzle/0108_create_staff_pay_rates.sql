CREATE TABLE "staff_pay_rates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"component" text NOT NULL,
	"rate_type" text NOT NULL,
	"slot" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"benefit_form" text,
	"taxable" boolean,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text,
	"closed_by_rate_id" uuid,
	"closed_from_end_date" date,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_pay_rates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_pay_rates_component_check" CHECK ("staff_pay_rates"."component" in ('wage', 'lesson', 'benefit')),
	CONSTRAINT "staff_pay_rates_rate_type_check" CHECK (("staff_pay_rates"."component" = 'wage' and "staff_pay_rates"."rate_type" in ('monthly_gross', 'monthly_net', 'hourly', 'lesson_hour'))
        or ("staff_pay_rates"."component" = 'lesson' and "staff_pay_rates"."rate_type" in ('extra', 'duty'))
        or ("staff_pay_rates"."component" = 'benefit' and "staff_pay_rates"."rate_type" in ('meal', 'transport', 'child', 'service'))),
	CONSTRAINT "staff_pay_rates_slot_check" CHECK ("staff_pay_rates"."slot" = case when "staff_pay_rates"."component" = 'wage' then 'wage'
        else "staff_pay_rates"."component" || ':' || "staff_pay_rates"."rate_type" end),
	CONSTRAINT "staff_pay_rates_amount_check" CHECK ("staff_pay_rates"."amount_cents" > 0 and "staff_pay_rates"."amount_cents" <= 1000000000),
	CONSTRAINT "staff_pay_rates_currency_check" CHECK ("staff_pay_rates"."currency" = 'TRY'),
	CONSTRAINT "staff_pay_rates_benefit_check" CHECK ((("staff_pay_rates"."component" = 'benefit') = ("staff_pay_rates"."benefit_form" is not null))
        and (("staff_pay_rates"."component" = 'benefit') = ("staff_pay_rates"."taxable" is not null))
        and ("staff_pay_rates"."benefit_form" is null or "staff_pay_rates"."benefit_form" in ('cash', 'in_kind'))),
	CONSTRAINT "staff_pay_rates_dates_check" CHECK ("staff_pay_rates"."end_date" is null or "staff_pay_rates"."end_date" >= "staff_pay_rates"."start_date"),
	CONSTRAINT "staff_pay_rates_note_check" CHECK ("staff_pay_rates"."note" is null or char_length("staff_pay_rates"."note") between 1 and 200),
	CONSTRAINT "staff_pay_rates_closed_check" CHECK ("staff_pay_rates"."closed_from_end_date" is null or "staff_pay_rates"."closed_by_rate_id" is not null),
	CONSTRAINT "staff_pay_rates_cancel_check" CHECK ((("staff_pay_rates"."archived_at" is null) = ("staff_pay_rates"."cancel_reason" is null))
        and (("staff_pay_rates"."archived_at" is null) = ("staff_pay_rates"."cancelled_by_user_id" is null))
        and ("staff_pay_rates"."cancel_reason" is null or char_length("staff_pay_rates"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_pay_rates" ADD CONSTRAINT "staff_pay_rates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay_rates" ADD CONSTRAINT "staff_pay_rates_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay_rates" ADD CONSTRAINT "staff_pay_rates_closed_by_fkey" FOREIGN KEY ("institution_id","closed_by_rate_id") REFERENCES "public"."staff_pay_rates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_pay_rates_open_key" ON "staff_pay_rates" USING btree ("institution_id","membership_id","slot") WHERE "staff_pay_rates"."end_date" is null and "staff_pay_rates"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_pay_rates_start_key" ON "staff_pay_rates" USING btree ("institution_id","membership_id","slot","start_date") WHERE "staff_pay_rates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_pay_rates_membership_idx" ON "staff_pay_rates" USING btree ("institution_id","membership_id","slot","start_date");--> statement-breakpoint
CREATE INDEX "staff_pay_rates_closed_by_idx" ON "staff_pay_rates" USING btree ("institution_id","closed_by_rate_id");--> statement-breakpoint
COMMENT ON TABLE "staff_pay_rates" IS 'Personel ücret tanımı (DOM-FIN-099, ON-194, K-304…K-307): bir personel üyeliğine yürürlük tarihli ana ücret (aylık brüt, aylık net, saatlik, ders saati), ek ders ücreti (ek ders, nöbet; saat başı) ya da yan hak (yemek, yol, çocuk yardımı, servis; aylık). Bir yuvada aralıklar çakışmaz; yeni tanım son tanımı başlangıcından bir gün önceye kendiliğinden kapatır. Tanım düzeltilmez: yalnız yuvanın son tanımının bitişi değişir ya da gerekçeyle iptal (arşiv) edilir. Ücret kişisel veridir: yalnız yönetici okur ve yazar, tutar içeren her okuma denetim kaydına yazılır (K-306, K-307).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."id" IS 'Tanım kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."membership_id" IS 'Tanımın yapıldığı personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Üyelik silinirse geçmiş korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."component" IS 'Bileşen: wage ana ücret, lesson ek ders ücreti, benefit yan hak.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."rate_type" IS 'Tür. Ana ücrette monthly_gross aylık brüt, monthly_net aylık net, hourly saatlik, lesson_hour ders saati; ek derste extra ek ders (yedek ders dahil), duty nöbet; yan hakta meal yemek, transport yol, child çocuk yardımı, service servis.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."slot" IS 'Çakışma yuvası (K-304): ana ücrette wage (tür değişse de tek), diğerlerinde bileşen:tür. Yuvada aralıklar çakışmaz; tek süresiz tanım ve tek başlangıç günü kısmi tekil indekslerle güvencededir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."amount_cents" IS 'Tutar, kuruş (0 < tutar ≤ 10.000.000 ₺). Ana ücrette türün birimi (aylık, saat ya da ders saati başı), ek derste saat başı, yan hakta aylık. Kişisel veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."benefit_form" IS 'Yan hakta cash nakdi, in_kind ayni; diğer bileşenlerde boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."taxable" IS 'Yan hak gelir vergisine tabi mi (kullanıcı işareti; M-38); diğer bileşenlerde boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."start_date" IS 'Yürürlük başlangıcı (gün, dahil). Yeni tanım yuvanın son tanımından sonra başlar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."end_date" IS 'Yürürlük bitişi (gün, dahil); boşsa süresiz. Yeni tanım eklenince başlangıcından bir gün önceye kendiliğinden çekilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."note" IS 'İsteğe bağlı not (1–200 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."closed_by_rate_id" IS 'Bu tanımı kendiliğinden kapatan sonraki tanım; kapatan iptal edilince boşalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."closed_from_end_date" IS 'Kendiliğinden kapatılmadan önceki bitiş (boşsa süresizdi); kapatan tanım iptal edilince end_date kolonuna geri yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."created_by_user_id" IS 'Tanımı yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); yalnız iptal edilmiş (arşivli) tanımda. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."cancelled_by_user_id" IS 'Tanımı iptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."archived_at" IS 'İptal anı; iptal edilen tanım yürürlükte sayılmaz ve listelenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_pay_rates"."version" IS 'İyimser kilit sürümü (If-Match).';
