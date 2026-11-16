CREATE TABLE "payroll_parameter_sets" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"minimum_wage_gross_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"income_tax_brackets" jsonb NOT NULL,
	"sgk_employee_rate_basis_points" integer NOT NULL,
	"sgk_employer_rate_basis_points" integer NOT NULL,
	"sgk_employer_incentive_basis_points" integer NOT NULL,
	"unemployment_employee_rate_basis_points" integer NOT NULL,
	"unemployment_employer_rate_basis_points" integer NOT NULL,
	"sgk_floor_multiplier_basis_points" integer NOT NULL,
	"sgk_ceiling_multiplier_basis_points" integer NOT NULL,
	"stamp_tax_rate_per_100k" integer NOT NULL,
	"minimum_wage_income_tax_exempt" boolean NOT NULL,
	"minimum_wage_stamp_tax_exempt" boolean NOT NULL,
	"severance_ceiling_cents" bigint NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_parameter_sets_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_parameter_sets_effective_from_check" CHECK (extract(day from "payroll_parameter_sets"."effective_from") = 1
        and "payroll_parameter_sets"."effective_from" between date '2020-01-01' and date '2099-12-01'),
	CONSTRAINT "payroll_parameter_sets_amounts_check" CHECK ("payroll_parameter_sets"."minimum_wage_gross_cents" > 0 and "payroll_parameter_sets"."severance_ceiling_cents" > 0),
	CONSTRAINT "payroll_parameter_sets_currency_check" CHECK ("payroll_parameter_sets"."currency" = 'TRY'),
	CONSTRAINT "payroll_parameter_sets_brackets_check" CHECK (jsonb_typeof("payroll_parameter_sets"."income_tax_brackets") = 'array'
        and jsonb_array_length("payroll_parameter_sets"."income_tax_brackets") between 1 and 10),
	CONSTRAINT "payroll_parameter_sets_rates_check" CHECK ("payroll_parameter_sets"."sgk_employee_rate_basis_points" between 0 and 10000
        and "payroll_parameter_sets"."sgk_employer_rate_basis_points" between 0 and 10000
        and "payroll_parameter_sets"."sgk_employer_incentive_basis_points" between 0 and "payroll_parameter_sets"."sgk_employer_rate_basis_points"
        and "payroll_parameter_sets"."unemployment_employee_rate_basis_points" between 0 and 10000
        and "payroll_parameter_sets"."unemployment_employer_rate_basis_points" between 0 and 10000
        and "payroll_parameter_sets"."stamp_tax_rate_per_100k" between 0 and 10000),
	CONSTRAINT "payroll_parameter_sets_multipliers_check" CHECK ("payroll_parameter_sets"."sgk_floor_multiplier_basis_points" > 0
        and "payroll_parameter_sets"."sgk_ceiling_multiplier_basis_points" > "payroll_parameter_sets"."sgk_floor_multiplier_basis_points"
        and "payroll_parameter_sets"."sgk_ceiling_multiplier_basis_points" <= 200000)
);
--> statement-breakpoint
ALTER TABLE "payroll_parameter_sets" ADD CONSTRAINT "payroll_parameter_sets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_parameter_sets_effective_from_key" ON "payroll_parameter_sets" USING btree ("institution_id","effective_from") WHERE "payroll_parameter_sets"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "payroll_parameter_sets" IS 'Bordro parametrelerinin kurum kopyası (DOM-FIN-100, ON-197): yürürlük başlangıcından itibaren geçerli asgari ücret, gelir vergisi dilimleri, SGK ve işsizlik sigortası payları, SGK taban ve tavan çarpanı, damga vergisi oranı, asgari ücret istisnaları ve kıdem tazminatı tavanı. Platform varsayılanı kodda durur (school-core PAYROLL_PLATFORM_DEFAULTS, K-308); aynı yürürlük başlangıcındaki kurum seti platform setinin yerini alır, arşivlenince platform değeri geri gelir (K-309). Bir günde geçerli set, başlangıcı o güne eşit ya da önce olan en geç settir. Her set tamdır; net asgari ücret ve SGK taban/tavan tutarı saklanmaz, hesaplanır (K-310). Yalnız yönetici yazar; değerler mali müşavirle doğrulanmalıdır (M-40, M-41).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."id" IS 'Parametre seti kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."effective_from" IS 'Yürürlük başlangıcı; ayın ilk günü, 2020-01-01 ile 2099-12-01 arası (K-311). Kurumda arşivlenmemiş sette tekildir (payroll_parameter_sets_effective_from_key). Yıl ortası değişim (asgari ücret artışı, temmuz kıdem tavanı) yeni başlangıçlı settir.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."minimum_wage_gross_cents" IS 'Aylık brüt asgari ücret, kuruş (> 0). Net asgari ücret ve SGK taban/tavan tutarı bundan hesaplanır.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."currency" IS 'Tutarların para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."income_tax_brackets" IS 'Ücret gelir vergisi tarifesi (GVK md. 103): [{lowerBoundCents, rateBasisPoints}] dizisi, 1–10 dilim. İlk dilim 0 kuruştan başlar; alt sınırlar (yıllık kümülatif matrah, kuruş) ve oranlar (on binde bir, 0–10000) kesin artandır, dilimler çakışmaz; bir dilimin üst sınırı sonrakinin alt sınırıdır, son dilim sınırsızdır. Yazmadan önce incomeTaxBracketsSchema ile doğrulanır.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."sgk_employee_rate_basis_points" IS 'SGK işçi payı, on binde bir (5510 md. 81; malullük-yaşlılık-ölüm + genel sağlık sigortası, bugün 1400 = %14).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."sgk_employer_rate_basis_points" IS 'SGK işveren payı, indirimsiz, on binde bir (5510 md. 81; malullük-yaşlılık-ölüm + genel sağlık + kısa vadeli sigorta, bugün 2075 = %20,75).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."sgk_employer_incentive_basis_points" IS 'İşveren prim indirimi (5510 md. 81/ı Hazine desteği), on binde bir; işveren payını aşamaz. İndirimli işveren oranı işveren payı eksi bu değerdir (hesaplanır).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."unemployment_employee_rate_basis_points" IS 'İşsizlik sigortası işçi payı, on binde bir (4447 md. 49; bugün 100 = %1).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."unemployment_employer_rate_basis_points" IS 'İşsizlik sigortası işveren payı, on binde bir (4447 md. 49; bugün 200 = %2).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."sgk_floor_multiplier_basis_points" IS 'Prime esas kazanç alt sınırının brüt asgari ücrete oranı, on binde bir (10000 = 1 kat; 5510 md. 82).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."sgk_ceiling_multiplier_basis_points" IS 'Prime esas kazanç üst sınırının brüt asgari ücrete oranı, on binde bir (75000 = 7,5 kat, 90000 = 9 kat; 5510 md. 82); taban çarpanından büyük, en çok 20 kat.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."stamp_tax_rate_per_100k" IS 'Ücretlerde damga vergisi oranı, yüz binde bir (759 = binde 7,59; 488 sayılı DVK (1) sayılı tablo IV-1); en çok %10.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."minimum_wage_income_tax_exempt" IS 'Asgari ücret gelir vergisi istisnası uygulanır mı (GVK md. 23/18; 2022''den beri açık).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."minimum_wage_stamp_tax_exempt" IS 'Asgari ücret damga vergisi istisnası uygulanır mı (DVK md. 9; 2022''den beri açık).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."severance_ceiling_cents" IS 'Kıdem tazminatı tavanı, aylık, kuruş (> 0; 1475 md. 14). Kıdem hesaplayıcısı (DOM-FIN-094) bugün kendi tablosunu kullanır; bu kolon parametre tablosuna geçişte okunur.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."source" IS 'Değerlerin kaynağı, 3–300 karakter (Resmî Gazete, GİB tarifesi, SGK duyurusu ya da mali müşavir yazısı).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."created_by_user_id" IS 'Seti oluşturan kullanıcı (yönetici). Düzeltme ve arşivi yapan audit_log kaydındadır.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."archived_at" IS 'Arşiv zamanı; arşivli set geçerli set çözümüne girmez, aynı başlangıçlı platform seti yeniden geçerli olur.';--> statement-breakpoint
COMMENT ON COLUMN "payroll_parameter_sets"."version" IS 'İyimser kilit sürümü (If-Match; düzeltme ve arşivde artar).';
