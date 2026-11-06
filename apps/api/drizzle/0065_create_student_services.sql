CREATE TABLE "student_service_invoices" (
	"institution_id" text NOT NULL,
	"student_service_id" uuid NOT NULL,
	"invoice_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_service_invoices_pkey" PRIMARY KEY("institution_id","student_service_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "student_services" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"academic_year" integer NOT NULL,
	"tariff_id" uuid NOT NULL,
	"tariff_version" integer NOT NULL,
	"fee_level" text,
	"unit" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tariff_amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"contract_id" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_date" date,
	"end_reason" text,
	"created_by_user_id" text NOT NULL,
	"ended_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_services_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "student_services_kind_check" CHECK ("student_services"."kind" in ('transport', 'meal', 'breakfast', 'club', 'tutoring', 'dormitory')),
	CONSTRAINT "student_services_unit_check" CHECK ("student_services"."unit" in ('year', 'month', 'lesson_hour', 'item')),
	CONSTRAINT "student_services_status_check" CHECK ("student_services"."status" in ('active', 'ended')),
	CONSTRAINT "student_services_end_reason_check" CHECK ("student_services"."end_reason" is null or "student_services"."end_reason" in ('request', 'withdrawal')),
	CONSTRAINT "student_services_amount_check" CHECK ("student_services"."amount_cents" > 0 and "student_services"."amount_cents" <= "student_services"."tariff_amount_cents"),
	CONSTRAINT "student_services_currency_check" CHECK ("student_services"."currency" = 'TRY'),
	CONSTRAINT "student_services_dates_check" CHECK (("student_services"."end_date" is null or "student_services"."end_date" >= "student_services"."start_date") and ("student_services"."ended_date" is null or "student_services"."ended_date" >= "student_services"."start_date")),
	CONSTRAINT "student_services_ended_check" CHECK (("student_services"."status" = 'ended') = ("student_services"."ended_date" is not null) and ("student_services"."ended_date" is null) = ("student_services"."end_reason" is null) and ("student_services"."ended_date" is null) = ("student_services"."ended_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "student_service_invoices" ADD CONSTRAINT "student_service_invoices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_invoices" ADD CONSTRAINT "student_service_invoices_service_fkey" FOREIGN KEY ("institution_id","student_service_id") REFERENCES "public"."student_services"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_invoices" ADD CONSTRAINT "student_service_invoices_invoice_fkey" FOREIGN KEY ("institution_id","invoice_id") REFERENCES "public"."invoices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_services" ADD CONSTRAINT "student_services_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_services" ADD CONSTRAINT "student_services_tariff_fkey" FOREIGN KEY ("institution_id","tariff_id") REFERENCES "public"."fee_tariffs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_services" ADD CONSTRAINT "student_services_contract_fkey" FOREIGN KEY ("institution_id","contract_id") REFERENCES "public"."contracts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_service_invoices_invoice_key" ON "student_service_invoices" USING btree ("institution_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_services_student_kind_open_key" ON "student_services" USING btree ("institution_id","student_id","kind") WHERE "student_services"."status" = 'active' and "student_services"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "student_services_student_idx" ON "student_services" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "student_services_tariff_idx" ON "student_services" USING btree ("institution_id","tariff_id");--> statement-breakpoint
CREATE INDEX "student_services_contract_idx" ON "student_services" USING btree ("institution_id","contract_id") WHERE "student_services"."contract_id" is not null;--> statement-breakpoint
-- ELLE EKLENDİ (ON-087) başlangıç: Türkçe tablo ve kolon yorumları. Migration yeniden üretilirse bu blok korunur.
COMMENT ON TABLE "student_services" IS 'Ek hizmet aboneliği (DOM-FIN-003; ON-087): öğrencinin dönem içinde servis, yemek, kulüp gibi hizmete yazılması ve çıkması. Ücret tarifeden hesaplanır, öğrenimden ayrı taksit açar (student_service_invoices). Aynı öğrenci ve türde tek açık abonelik olur.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."id" IS 'Abonelik kimliği (uuid).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."student_id" IS 'Öğrenci; records students kimliği, yabancı anahtar değildir (ADR 0010 karar 6). Kişisel veri sınıfı Ç.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."kind" IS 'Hizmet türü: core STUDENT_SERVICE_KINDS (transport, meal, breakfast, club, tutoring, dormitory). Tek seferlik kalem (kitap, kıyafet) abonelik açmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."academic_year" IS 'Eğitim yılının başlangıç yılı; ücretin dayandığı yıl.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."tariff_id" IS 'Ücretin alındığı yayımlı tarife (DOM-FIN-002); süresinde ilan yoksa önceki yılınki olabilir (K-11). Silinemez (restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."tariff_version" IS 'Tarifenin yıl içindeki sürümü; karar anı kopyası.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."fee_level" IS 'Tarifedeki kalemin düzeyi; bütün düzeylere uygulanan kalemde boş.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."unit" IS 'Kalemin ücret birimi: aylık (month) kalem her ay taksit açar, öteki birimler başlangıçta tek taksit açar.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."amount_cents" IS 'Uygulanan birim ücret, kuruş; aylık kalemde bir ayın tutarı. Personel tarifenin altına düzeltebilir, üstüne çıkamaz (K-17); tarife sonradan değişse de kalır. Kişisel veri sınıfı Ç.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."tariff_amount_cents" IS 'Yazılma anında tarifedeki birim ücret, kuruş; önerilen tutar ve üst sınır, sonradan değişmez (K-17).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."currency" IS 'Para birimi; yalnız TRY (DOM-FIN-001).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."contract_id" IS 'Yazılma anında öğrencinin o yıl yürürlükteki sözleşme sürümü; yalnız kaynak bilgisidir. Taksit sözleşmenin planına girmez, onaylı sözleşme değişmez (DOM-FIN-010). Sözleşmesi yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."start_date" IS 'Hizmetin başladığı gün (YYYY-MM-DD); ilk taksitin vadesi.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."end_date" IS 'Yazılırken planlanan bitiş günü; aylık kalemde zorunlu, ötekilerde boş olabilir. Çıkışta değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."status" IS 'Durum: active (açık) ya da ended (sona erdi).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."ended_date" IS 'Gerçek çıkış günü; yalnız sona eren abonelikte dolu. Başlamadan ayrılışta başlangıç gününe çekilir.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."end_reason" IS 'Çıkış nedeni: request (talep) ya da withdrawal (ayrılışta kapanış).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."created_by_user_id" IS 'Aboneliği işleyen görevli. Kişisel veri sınıfı K.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."ended_by_user_id" IS 'Çıkışı işleyen kullanıcı (ayrılışta ayrılışı onaylayan). Kişisel veri sınıfı K.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."created_at" IS 'Satırın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."updated_at" IS 'Satırın son güncellenme anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."archived_at" IS 'Arşiv anı; arşivli satır açık abonelik sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "student_services"."version" IS 'İyimser kilit sürümü; If-Match değeri.';
--> statement-breakpoint
COMMENT ON INDEX "student_services_student_kind_open_key" IS 'Aynı öğrenci ve türde tek açık abonelik (DOM-FIN-003). Çekirdek kuralı student_service_open ile aynıdır; indeks son güvencedir.';
--> statement-breakpoint
COMMENT ON TABLE "student_service_invoices" IS 'Aboneliğin açtığı taksitler (ON-087). Bir taksit tek aboneliğe bağlıdır. Çıkışta iptal edilen taksitin satırı invoices tablosunda arşivlenir, bağ kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."student_service_id" IS 'Abonelik.';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."invoice_id" IS 'Taksit; sözleşmesiz ek hizmet taksitidir (invoices.contract_id boş).';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."created_at" IS 'Satırın oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."updated_at" IS 'Satırın son güncellenme anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."archived_at" IS 'Arşiv anı; bugün yazılmaz, zorunlu kolondur.';
--> statement-breakpoint
COMMENT ON COLUMN "student_service_invoices"."version" IS 'Satır sürümü; zorunlu kolondur.';
-- ELLE EKLENDİ (ON-087) bitiş