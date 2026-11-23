CREATE TABLE "price_index_rates" (
	"institution_id" text NOT NULL,
	"academic_year" integer NOT NULL,
	"ppi_basis_points" integer NOT NULL,
	"cpi_basis_points" integer NOT NULL,
	"source" text NOT NULL,
	"bulletin_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_index_rates_pkey" PRIMARY KEY("institution_id","academic_year"),
	CONSTRAINT "price_index_rates_ppi_check" CHECK ("price_index_rates"."ppi_basis_points" >= 0),
	CONSTRAINT "price_index_rates_cpi_check" CHECK ("price_index_rates"."cpi_basis_points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "price_index_rates" ADD CONSTRAINT "price_index_rates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "price_index_rates" IS 'Yenilemede artış tavanının ÜFE ve TÜFE profili (DOM-FIN-005). Kurum ve ücret yılı başına tek satır; değer kaynağıyla girilir.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."academic_year" IS 'Tavanın uygulandığı ücretin eğitim yılı (başlangıç yılı); oranlar bir önceki yılın ortalamalarıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."ppi_basis_points" IS 'ÜFE ortalaması, on binde birlik (yüzde 42,5 için 4250).';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."cpi_basis_points" IS 'TÜFE ortalaması, on binde birlik (yüzde 42,5 için 4250).';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."source" IS 'Değerin kaynağı (TÜİK bülteni adı veya numarası).';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."bulletin_date" IS 'Kaynak bültenin tarihi; gelecekte olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';
--> statement-breakpoint
COMMENT ON COLUMN "price_index_rates"."version" IS 'İyimser kilit sürümü (If-Match).';
