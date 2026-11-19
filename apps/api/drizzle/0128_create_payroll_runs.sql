CREATE TABLE "payroll_run_lines" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"month" text NOT NULL,
	"gross_cents" bigint NOT NULL,
	"income_tax_base_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"payable_cents" bigint NOT NULL,
	"employer_cost_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"line" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_run_lines_month_check" CHECK ("payroll_run_lines"."month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_run_lines_amounts_check" CHECK ("payroll_run_lines"."gross_cents" >= 0 and "payroll_run_lines"."income_tax_base_cents" >= 0
        and "payroll_run_lines"."employer_cost_cents" >= 0),
	CONSTRAINT "payroll_run_lines_currency_check" CHECK ("payroll_run_lines"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"month" text NOT NULL,
	"revision" integer NOT NULL,
	"parameter_set_id" text NOT NULL,
	"parameter_effective_from" date NOT NULL,
	"staff_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"gross_total_cents" bigint NOT NULL,
	"net_total_cents" bigint NOT NULL,
	"payable_total_cents" bigint NOT NULL,
	"employer_cost_total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"calculated_by_user_id" text NOT NULL,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_runs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_runs_month_check" CHECK ("payroll_runs"."month" ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_counts_check" CHECK ("payroll_runs"."revision" >= 1 and "payroll_runs"."staff_count" >= 1 and "payroll_runs"."skipped_count" >= 0
        and "payroll_runs"."gross_total_cents" >= 0 and "payroll_runs"."employer_cost_total_cents" >= 0),
	CONSTRAINT "payroll_runs_currency_check" CHECK ("payroll_runs"."currency" = 'TRY'),
	CONSTRAINT "payroll_runs_archive_check" CHECK (("payroll_runs"."archived_at" is null) = ("payroll_runs"."archived_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_carryovers" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"year" integer NOT NULL,
	"income_tax_base_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_tax_carryovers_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_tax_carryovers_year_check" CHECK ("payroll_tax_carryovers"."year" between 2020 and 2099),
	CONSTRAINT "payroll_tax_carryovers_amount_check" CHECK ("payroll_tax_carryovers"."income_tax_base_cents" between 1 and 100000000000),
	CONSTRAINT "payroll_tax_carryovers_currency_check" CHECK ("payroll_tax_carryovers"."currency" = 'TRY'),
	CONSTRAINT "payroll_tax_carryovers_note_check" CHECK ("payroll_tax_carryovers"."note" is null or char_length("payroll_tax_carryovers"."note") between 1 and 200),
	CONSTRAINT "payroll_tax_carryovers_archive_check" CHECK (("payroll_tax_carryovers"."archived_at" is null) = ("payroll_tax_carryovers"."archived_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_fkey" FOREIGN KEY ("institution_id","run_id") REFERENCES "public"."payroll_runs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_carryovers" ADD CONSTRAINT "payroll_tax_carryovers_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_carryovers" ADD CONSTRAINT "payroll_tax_carryovers_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_lines_member_key" ON "payroll_run_lines" USING btree ("institution_id","run_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_membership_idx" ON "payroll_run_lines" USING btree ("institution_id","membership_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month_key" ON "payroll_runs" USING btree ("institution_id","month") WHERE "payroll_runs"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_revision_key" ON "payroll_runs" USING btree ("institution_id","month","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_tax_carryovers_member_year_key" ON "payroll_tax_carryovers" USING btree ("institution_id","membership_id","year") WHERE "payroll_tax_carryovers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payroll_tax_carryovers_year_idx" ON "payroll_tax_carryovers" USING btree ("institution_id","year");--> statement-breakpoint
-- Kayıtlı bordro satırı değişmez (DOM-FIN-115, K-391): `kampus_reject_immutable_change()` (migration 0013).
CREATE TRIGGER "payroll_run_lines_immutable_trigger" BEFORE UPDATE OR DELETE ON "payroll_run_lines" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "payroll_run_lines_truncate_trigger" BEFORE TRUNCATE ON "payroll_run_lines" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "payroll_runs" IS 'Kayıtlı bordro hesabı (DOM-FIN-115, ON-198, K-391): Kampüs bordroyu kendisi hesaplar (ON-193, ADR 0011). Kurumda ay başına tek etkin hesap; yeniden hesaplama eski hesabı arşivler ve revizyonu bir artırılmış yeni hesap yazar. Onaylı (kilitli) ayda (payroll_periods) kaydetme ve yeniden hesaplama 409 olur: onay hesabı dondurur. Yalnız yönetici okur ve yazar; hesap mali müşavir doğrulaması bekler (M-75…M-77).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."id" IS 'Hesap kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."month" IS 'Bordro ayı (YYYY-AA, 2020–2099).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."revision" IS 'Ayın kaçıncı hesabı (1’den başlar); yeniden hesaplamada bir artar, ay ve revizyon kurumda tekildir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."parameter_set_id" IS 'Hesabın kullandığı bordro parametre seti (DOM-FIN-100; platform-<gün> ya da kurum setinin kimliği); ayın ilk günü geçerli settir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."parameter_effective_from" IS 'Kullanılan parametre setinin yürürlük başlangıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."staff_count" IS 'Hesaplanıp kaydedilen personel satırı sayısı (en az 1).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."skipped_count" IS 'Hesaplanamadığı için kayda girmeyen personel sayısı (saatlik ücret, ücret tanımı yok).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."gross_total_cents" IS 'Kaydedilen satırların brüt toplamı, kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."net_total_cents" IS 'Kaydedilen satırların net ücret toplamı (kesintilerden önce), kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."payable_total_cents" IS 'Kaydedilen satırların ödenecek net toplamı (kesintiler ve net düzeltmelerden sonra), kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."employer_cost_total_cents" IS 'Kaydedilen satırların işveren maliyeti toplamı (brüt + SGK ve işsizlik işveren payları + ayni yan haklar), kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."calculated_by_user_id" IS 'Hesabı kaydeden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."archived_by_user_id" IS 'Hesabı yeniden hesaplayarak arşivleyen yönetici; yalnız arşivli hesapta dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."created_at" IS 'Hesabın kaydedildiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."updated_at" IS 'Son değişiklik anı (UTC); yalnız arşivde değişir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."archived_at" IS 'Yeniden hesaplamayla geçersizleştiği an; arşivli hesap kümülatif matraha girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."version" IS 'İyimser kilit sürümü.';
--> statement-breakpoint
COMMENT ON TABLE "payroll_run_lines" IS 'Kayıtlı bordro hesabının personel satırı (DOM-FIN-115, K-391): hesabın bütün ayrıntısı (kalemler, SGK, vergi ve istisnalar, kesinti satırları, işveren payları, uyarılar) `line` içinde; ana tutarlar sorgu için ayrıca kolondadır. Kümülatif gelir vergisi matrahı etkin hesapların bu satırlarından okunur. Satır değişmez (kampus_reject_immutable_change). Ücret ve icra bilgisi kişisel veridir; yalnız yönetici okur ve her okuma denetime düşer.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."id" IS 'Satır kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."run_id" IS 'Satırın ait olduğu hesap (payroll_runs). Hesap silinmez: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."membership_id" IS 'Personelin kurum üyeliği (memberships). Üyelik silinirse satır korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."month" IS 'Bordro ayı (YYYY-AA); hesabın ayıyla aynıdır, kümülatif matrah sorgusu için.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."gross_cents" IS 'Brüt (SGK matrahına giren kalemler), kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."income_tax_base_cents" IS 'Ayın gelir vergisi matrahı (vergiye tabi brüt − işçi SGK − işsizlik işçi payı), kuruş; yıl içindeki sonraki ayların kümülatif matrahına girer.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."net_cents" IS 'Net ücret (kesintilerden önce), kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."payable_cents" IS 'Ödenecek net (kesinti ve net düzeltmeden sonra), kuruş; icra tavanı nedeniyle eksiye düşmez, net düzeltme eksiye indirebilir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."employer_cost_cents" IS 'İşveren maliyeti, kuruş.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."line" IS 'Satırın tam hesabı (school-core PayrollCalcRow): kalemler, matrahlar, istisnalar, kesinti satırları (kaynak kimliği ve tutar), uyarı kodları. Değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."updated_at" IS 'Yazıldığı anla aynı; satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."archived_at" IS 'Kullanılmaz; satır hesabıyla birlikte geçersizleşir (hesabın archived_at alanı).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."version" IS 'Sabit 1; satır değişmez.';
--> statement-breakpoint
COMMENT ON TABLE "payroll_tax_carryovers" IS 'Kümülatif gelir vergisi matrahı devri (DOM-FIN-115, K-388): personelin yıl içinde önceki işyerinde ya da Kampüs öncesinde oluşan kümülatif matrahı; o yılın bütün aylarının hesabında önceki kümülatife eklenir. Personel × yıl başına tek etkin kayıt; düzeltilmez, kaldırılır (arşiv) ve yeniden girilir. Kayıtlı hesaplar devirden sonra kendiliğinden değişmez. Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."id" IS 'Kayıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."membership_id" IS 'Personelin kurum üyeliği (memberships). Üyelik silinirse kayıt korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."year" IS 'Devrin yılı (2020–2099).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."income_tax_base_cents" IS 'Devralınan kümülatif gelir vergisi matrahı, kuruş (1 kuruş–1.000.000.000 ₺).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."note" IS 'İsteğe bağlı kaynak notu (1–200 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."created_by_user_id" IS 'Kaydı giren yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."archived_by_user_id" IS 'Kaydı kaldıran yönetici; yalnız arşivli kayıtta dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."archived_at" IS 'Kaldırılma anı; arşivli devir hesaba girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_tax_carryovers"."version" IS 'İyimser kilit sürümü (If-Match ile kaldırma).';
