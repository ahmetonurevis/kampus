CREATE TABLE "payroll_export_profiles" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_exports" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"format" text NOT NULL,
	"line_count" integer NOT NULL,
	"staff_count" integer NOT NULL,
	"earning_cents" bigint NOT NULL,
	"deduction_cents" bigint NOT NULL,
	"missing_total_count" integer NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"content_sha256" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_exports_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_exports_format_check" CHECK ("payroll_exports"."format" in ('standard', 'profile')),
	CONSTRAINT "payroll_exports_month_check" CHECK (extract(day from "payroll_exports"."month_start") = 1),
	CONSTRAINT "payroll_exports_counts_check" CHECK ("payroll_exports"."line_count" >= 0 and "payroll_exports"."staff_count" >= 0 and "payroll_exports"."staff_count" <= "payroll_exports"."line_count"
        and "payroll_exports"."missing_total_count" >= 0 and "payroll_exports"."missing_total_count" <= "payroll_exports"."line_count"),
	CONSTRAINT "payroll_exports_amounts_check" CHECK ("payroll_exports"."earning_cents" >= 0 and "payroll_exports"."deduction_cents" >= 0),
	CONSTRAINT "payroll_exports_currency_check" CHECK ("payroll_exports"."currency" = 'TRY'),
	CONSTRAINT "payroll_exports_sha_check" CHECK ("payroll_exports"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payroll_lesson_hours" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"month_start" date NOT NULL,
	"lesson_type" text NOT NULL,
	"hours" integer NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_lesson_hours_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "payroll_lesson_hours_lesson_type_check" CHECK ("payroll_lesson_hours"."lesson_type" in ('extra', 'duty')),
	CONSTRAINT "payroll_lesson_hours_hours_check" CHECK ("payroll_lesson_hours"."hours" between 1 and 400),
	CONSTRAINT "payroll_lesson_hours_month_check" CHECK (extract(day from "payroll_lesson_hours"."month_start") = 1),
	CONSTRAINT "payroll_lesson_hours_note_check" CHECK ("payroll_lesson_hours"."note" is null or char_length("payroll_lesson_hours"."note") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "payroll_export_profiles" ADD CONSTRAINT "payroll_export_profiles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lesson_hours" ADD CONSTRAINT "payroll_lesson_hours_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lesson_hours" ADD CONSTRAINT "payroll_lesson_hours_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_exports_month_idx" ON "payroll_exports" USING btree ("institution_id","month_start","created_at");--> statement-breakpoint
CREATE INDEX "payroll_exports_created_idx" ON "payroll_exports" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lesson_hours_entry_key" ON "payroll_lesson_hours" USING btree ("institution_id","membership_id","month_start","lesson_type") WHERE "payroll_lesson_hours"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payroll_lesson_hours_membership_idx" ON "payroll_lesson_hours" USING btree ("institution_id","membership_id","month_start");--> statement-breakpoint
CREATE INDEX "payroll_lesson_hours_month_idx" ON "payroll_lesson_hours" USING btree ("institution_id","month_start");--> statement-breakpoint
-- Dosya üretim özeti değişmez (DOM-FIN-105, K-338): `kampus_reject_immutable_change()` (migration 0013).
CREATE TRIGGER "payroll_exports_immutable_trigger" BEFORE UPDATE OR DELETE ON "payroll_exports" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
CREATE TRIGGER "payroll_exports_truncate_trigger" BEFORE TRUNCATE ON "payroll_exports" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "payroll_lesson_hours" IS 'Bordro aktarımı için ay içinde elle girilen ek ders saati (DOM-FIN-105, ON-202, K-337): personel × ay × ek ders türü × saat. Ders saati özeti (OG-116) gelene kadar bordro girdi dosyasının ek ders kaynağıdır; birim ücret ücret tanımından (staff_pay_rates, lesson bileşeni) okunur, saklanmaz. Aynı personel, ay ve türde tek etkin kayıt olur; kayıt düzeltilir ya da arşivlenir. Yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."id" IS 'Kayıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."membership_id" IS 'Saatin ait olduğu personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro; ay içinde ayrılan pasif personel de olabilir). Üyelik silinirse kayıt korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."month_start" IS 'Bordro ayının ilk günü (YYYY-AA-01). Gelecek ay girilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."lesson_type" IS 'Ek ders türü: extra ek ders (ders yükü üstü, yedek ders dahil), duty nöbet. Ücret tanımının ek ders türleriyle aynıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."hours" IS 'Ayın toplam saati, tam sayı (1–400). Tutar dosya üretilirken saat × ayın son tanımlı birim ücretiyle hesaplanır, saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."note" IS 'İsteğe bağlı not (1–200 karakter); dosyada ve denetim kaydında yer almaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."created_by_user_id" IS 'Kaydı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."created_at" IS 'Kaydın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."updated_at" IS 'Son düzeltme anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."archived_at" IS 'Arşiv (silme) anı; arşivli kayıt dosyaya girmez ve aynı ay ile türde yeni kayıt açılabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_lesson_hours"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "payroll_export_profiles" IS 'Kurumun bordro girdi dosyası sütun eşleme şablonu (DOM-FIN-105, ON-202, K-339): ayırıcı, ondalık işareti, tarih biçimi, sütun adı ve sırası, sabit sütunlar. Belirli bir bordro programının hazır şablonu değildir. Satır yoksa genel dosya (UTF-8 BOM, noktalı virgül, ondalık virgül) üretilir. Satırları ve toplamları değiştirmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."institution_id" IS 'Kurum; kurum başına tek şablon.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."profile" IS 'Şablon (school-core payrollExportProfileSchema ile doğrulanır); boşsa genel dosya. Kişisel veri taşımaz.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."created_at" IS 'Satırın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."archived_at" IS 'Kullanılmaz; şablon profile boş yazılarak genel dosyaya döner.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_export_profiles"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "payroll_exports" IS 'Bordro girdi dosyası üretim özeti (DOM-FIN-105, ON-202, K-338): her üretimde ay, biçim, satır ve personel sayısı, toplamlar ve dosyanın SHA-256 özeti yazılır; dosyanın kendisi ve ücret satırları saklanmaz. Kampüs bordro hesaplamaz (ON-193); dönem kilidi yoktur (ON-200), aynı ay yeniden üretilebilir ve her üretim ayrı satırdır. Satır değişmez (kampus_reject_immutable_change). Yalnız yönetici okur.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."id" IS 'Üretim kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."month_start" IS 'Dosyanın bordro ayının ilk günü (YYYY-AA-01).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."format" IS 'standard genel dosya, profile kurumun sütun eşleme şablonu.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."line_count" IS 'Dosyadaki kalem satırı sayısı (başlık hariç).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."staff_count" IS 'Dosyada satırı olan personel sayısı.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."earning_cents" IS 'Tutarı olan kazanç satırlarının toplamı, kuruş. Kısmi ay, saat ücreti ve tanımsız ek ders satırının tutarı boştur, toplama girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."deduction_cents" IS 'Tutarı olan kesinti satırlarının toplamı, kuruş; avans ve kesintiler (ON-199) gelene kadar 0.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."missing_total_count" IS 'Tutarı boş satır sayısı (bordro programında hesaplanacak).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."currency" IS 'Para birimi; yalnız TRY.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."content_sha256" IS 'İndirilen dosyanın (BOM dahil) SHA-256 özeti, küçük harf onaltılık; elde kalan dosyanın bu üretim olduğunu doğrulamak içindir.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."created_by_user_id" IS 'Dosyayı üreten yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."created_at" IS 'Üretim anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."updated_at" IS 'Üretim anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."archived_at" IS 'Kullanılmaz; satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_exports"."version" IS 'Sabit 1; satır değişmez.';
