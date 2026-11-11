CREATE TABLE "budget_items" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"fee_kind" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_items_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_items_code_check" CHECK ("budget_items"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'),
	CONSTRAINT "budget_items_name_check" CHECK (char_length("budget_items"."name") between 2 and 120),
	CONSTRAINT "budget_items_kind_check" CHECK ("budget_items"."kind" in ('income', 'expense')),
	CONSTRAINT "budget_items_fee_kind_check" CHECK ("budget_items"."fee_kind" is null or ("budget_items"."kind" = 'income' and "budget_items"."fee_kind" in ('tuition', 'breakfast', 'meal', 'transport', 'dormitory', 'stationery', 'uniform', 'tutoring')))
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"monthly_cents" bigint[],
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_lines_amount_check" CHECK ("budget_lines"."amount_cents" between 0 and 1000000000000),
	CONSTRAINT "budget_lines_monthly_check" CHECK ("budget_lines"."monthly_cents" is null or (cardinality("budget_lines"."monthly_cents") between 1 and 24 and 0 <= all("budget_lines"."monthly_cents"))),
	CONSTRAINT "budget_lines_currency_check" CHECK ("budget_lines"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"academic_year" integer,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opened_at" timestamp with time zone,
	"opened_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_periods_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "budget_periods_name_check" CHECK (char_length("budget_periods"."name") between 2 and 120),
	CONSTRAINT "budget_periods_academic_year_check" CHECK ("budget_periods"."academic_year" is null or "budget_periods"."academic_year" between 2000 and 2100),
	CONSTRAINT "budget_periods_dates_check" CHECK ("budget_periods"."end_date" >= "budget_periods"."start_date" and "budget_periods"."end_date" - "budget_periods"."start_date" < 366),
	CONSTRAINT "budget_periods_status_check" CHECK ("budget_periods"."status" in ('draft', 'open', 'closed')),
	CONSTRAINT "budget_periods_lifecycle_check" CHECK (("budget_periods"."status" = 'draft' and "budget_periods"."opened_at" is null and "budget_periods"."closed_at" is null)
        or ("budget_periods"."status" = 'open' and "budget_periods"."opened_at" is not null and "budget_periods"."opened_by_user_id" is not null and "budget_periods"."closed_at" is null)
        or ("budget_periods"."status" = 'closed' and "budget_periods"."opened_at" is not null and "budget_periods"."closed_at" is not null and "budget_periods"."closed_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" uuid,
	"campus_id" text,
	"grade_level" integer,
	"course_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cost_centers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "cost_centers_code_check" CHECK ("cost_centers"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'),
	CONSTRAINT "cost_centers_name_check" CHECK (char_length("cost_centers"."name") between 2 and 120),
	CONSTRAINT "cost_centers_type_check" CHECK ("cost_centers"."type" in ('campus', 'unit', 'program')),
	CONSTRAINT "cost_centers_parent_check" CHECK ("cost_centers"."parent_id" is null or "cost_centers"."parent_id" <> "cost_centers"."id"),
	CONSTRAINT "cost_centers_grade_level_check" CHECK ("cost_centers"."grade_level" is null or "cost_centers"."grade_level" between 5 and 12),
	CONSTRAINT "cost_centers_link_check" CHECK (("cost_centers"."type" = 'campus' and "cost_centers"."campus_id" is not null and "cost_centers"."grade_level" is null and "cost_centers"."course_id" is null)
        or ("cost_centers"."type" = 'unit' and "cost_centers"."campus_id" is null and "cost_centers"."grade_level" is null and "cost_centers"."course_id" is null)
        or ("cost_centers"."type" = 'program' and "cost_centers"."campus_id" is null and ("cost_centers"."grade_level" is null or "cost_centers"."course_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."budget_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_item_fkey" FOREIGN KEY ("institution_id","item_id") REFERENCES "public"."budget_items"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_fkey" FOREIGN KEY ("institution_id","parent_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_items_code_key" ON "budget_items" USING btree ("institution_id","code") WHERE "budget_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_items_fee_kind_key" ON "budget_items" USING btree ("institution_id","fee_kind") WHERE "budget_items"."fee_kind" is not null and "budget_items"."is_active" and "budget_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_key" ON "budget_lines" USING btree ("institution_id","period_id","cost_center_id","item_id") WHERE "budget_lines"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "budget_lines_cost_center_idx" ON "budget_lines" USING btree ("institution_id","cost_center_id");--> statement-breakpoint
CREATE INDEX "budget_lines_item_idx" ON "budget_lines" USING btree ("institution_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_name_key" ON "budget_periods" USING btree ("institution_id","name") WHERE "budget_periods"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers" USING btree ("institution_id","code") WHERE "cost_centers"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_campus_key" ON "cost_centers" USING btree ("institution_id","campus_id") WHERE "cost_centers"."campus_id" is not null and "cost_centers"."is_active" and "cost_centers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "cost_centers_parent_idx" ON "cost_centers" USING btree ("institution_id","parent_id");--> statement-breakpoint
CREATE INDEX "cost_centers_course_idx" ON "cost_centers" USING btree ("institution_id","course_id");--> statement-breakpoint
-- Elle eklendi (kolon açıklamaları; drizzle-kit üretmez, yeniden üretimde bu blok korunur).
COMMENT ON TABLE "cost_centers" IS 'Maliyet merkezi (DOM-FIN-062, ON-242, IST-010): kampüs, birim ya da program. Hiyerarşi aynı kurumun merkezine bağlanır, en çok 4 düzey (K-66), döngü core''da kurum kilidi altında denetlenir. Silinmez, is_active ile pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."id" IS 'Merkez kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."code" IS 'Merkez kodu; harf, rakam, nokta, alt çizgi, tire, büyük harfe çevrilmiş, en çok 20 karakter. Kurumda tekil (pasif dahil).';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."name" IS 'Merkez adı, 2–120 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."type" IS 'Tür: campus (kampüs), unit (birim), program (okulda sınıf düzeyi, dil okulunda kur). Oluşturulduktan sonra değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."parent_id" IS 'Üst merkez (cost_centers); kök merkezde boş. Üst merkez etkin olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."campus_id" IS 'Bağlı kampüs; records branches kimliği, yabancı anahtar değil. Yalnız kampüs türünde ve zorunlu; kampüse tek etkin merkez.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."grade_level" IS 'Okulda program merkezinin sınıf düzeyi (5–12); aynı üst merkez altında düzeye tek etkin program merkezi.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."course_id" IS 'Dil okulunda program merkezinin kuru (courses); aynı üst merkez altında kura tek etkin program merkezi.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."is_active" IS 'Etkin mi; pasif merkez yeni bütçe satırı almaz, üst merkez seçilemez. Altında etkin merkez olan pasifleşemez.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, merkez silinmez pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "cost_centers"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "budget_items" IS 'Bütçe kalemi (DOM-FIN-062, ON-241): gelir ya da gider tanımı. Gelir kalemi isteğe bağlı bir ücret türüne eşlenir; bir ücret türüne tek etkin gelir kalemi (K-65). Silinmez, pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."id" IS 'Kalem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."code" IS 'Kalem kodu; merkez koduyla aynı biçim, kurumda tekil (pasif dahil).';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."name" IS 'Kalem adı, 2–120 karakter.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."kind" IS 'Tür: income (gelir) ya da expense (gider). Bütçe satırında kullanılan kalemin türü değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."fee_kind" IS 'Gelir kaleminin eşlendiği ücret türü (FEE_ITEM_KINDS); gider kaleminde boş. Bütçe–gerçekleşen raporu (ON-244) tahsilatı bu eşlemeyle kaleme yazar.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."is_active" IS 'Etkin mi; pasif kalem yeni satır almaz.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, kalem silinmez pasifleşir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_items"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "budget_periods" IS 'Bütçe dönemi (DOM-FIN-062, ON-241, IST-011): eğitim yılına ya da gün aralığına bağlı. Durum taslak → açık → kapalı; açık dönemler örtüşmez (K-62), kapalı dönem ve satırları değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."id" IS 'Dönem kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."name" IS 'Dönem adı, 2–120 karakter; kurumda tekil.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."academic_year" IS 'Bağlı eğitim yılının başlangıç yılı (2026 → 2026–2027); gün aralığıyla tanımlanan dönemde boş.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."start_date" IS 'Dönemin ilk günü (dahil). Eğitim yılına bağlıysa oluşturma anında yılın kaydından kopyalanır (K-63). Yalnız taslakta değişir.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."end_date" IS 'Dönemin son günü (dahil); dönem en çok 366 gün.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."status" IS 'Durum: draft (taslak), open (açık), closed (kapalı). Geri dönmez; açma ve kapama yöneticidedir (K-61).';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."opened_at" IS 'Dönemin açıldığı an.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."opened_by_user_id" IS 'Dönemi açan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."closed_at" IS 'Dönemin kapandığı an; kapalı dönem değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."closed_by_user_id" IS 'Dönemi kapatan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."archived_at" IS 'Arşiv anı; bugün kullanılmaz, dönem silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_periods"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "budget_lines" IS 'Bütçe satırı: dönem × maliyet merkezi × kalem için planlanan tutar (DOM-FIN-062). Aynı üçlü için tek etkin satır; kaldırma arşivdir. Dönem toplamları bu satırlardan hesaplanır, saklanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."id" IS 'Satır kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."period_id" IS 'Bütçe dönemi (budget_periods).';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."cost_center_id" IS 'Maliyet merkezi (cost_centers); satır eklenirken etkin olmalıdır, sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."item_id" IS 'Bütçe kalemi (budget_items); satır eklenirken etkin olmalıdır, sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."amount_cents" IS 'Planlanan tutar, kuruş; 0 ile 10 milyar TL arası.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."monthly_cents" IS 'İsteğe bağlı aylık dağılım, kuruş: dönemin değdiği her takvim ayı için sırayla bir tutar; toplamı amount_cents (K-64, core denetler). Boşsa dağılım yoktur.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."currency" IS 'Para birimi; yalnız TRY (DOM-FIN-001).';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."created_at" IS 'Kayıt anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."updated_at" IS 'Son değişiklik anı.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."archived_at" IS 'Satırın kaldırıldığı an; kapalı dönemde satır kaldırılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "budget_lines"."version" IS 'İyimser kilit sürümü (If-Match).';
