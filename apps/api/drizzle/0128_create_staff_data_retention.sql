CREATE TABLE "staff_data_destructions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"category" text NOT NULL,
	"method" text NOT NULL,
	"record_count" integer NOT NULL,
	"file_count" integer NOT NULL,
	"retention_months" integer NOT NULL,
	"start_event" text NOT NULL,
	"destroyed_at" timestamp with time zone NOT NULL,
	"destroyed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_data_destructions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_data_destructions_category_check" CHECK ("staff_data_destructions"."category" in ('sick_leave_reports', 'health_reports', 'criminal_records', 'personnel_file', 'leave_records', 'payroll_records')),
	CONSTRAINT "staff_data_destructions_method_check" CHECK ("staff_data_destructions"."method" in ('delete', 'anonymize')),
	CONSTRAINT "staff_data_destructions_start_event_check" CHECK ("staff_data_destructions"."start_event" in ('separation_day', 'year_after_separation')),
	CONSTRAINT "staff_data_destructions_counts_check" CHECK ("staff_data_destructions"."record_count" > 0 and "staff_data_destructions"."file_count" >= 0),
	CONSTRAINT "staff_data_destructions_months_check" CHECK ("staff_data_destructions"."retention_months" between 1 and 360)
);
--> statement-breakpoint
CREATE TABLE "staff_retention_settings" (
	"institution_id" text NOT NULL,
	"category" text NOT NULL,
	"retention_months" integer,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_retention_settings_pkey" PRIMARY KEY("institution_id","category"),
	CONSTRAINT "staff_retention_settings_category_check" CHECK ("staff_retention_settings"."category" in ('sick_leave_reports', 'health_reports', 'criminal_records', 'personnel_file', 'leave_records', 'payroll_records')),
	CONSTRAINT "staff_retention_settings_months_check" CHECK ("staff_retention_settings"."retention_months" is null or "staff_retention_settings"."retention_months" between 1 and 360)
);
--> statement-breakpoint
ALTER TABLE "staff_data_destructions" ADD CONSTRAINT "staff_data_destructions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_retention_settings" ADD CONSTRAINT "staff_retention_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_data_destructions_destroyed_idx" ON "staff_data_destructions" USING btree ("institution_id","destroyed_at","id");--> statement-breakpoint
-- İmha kaydı değişmez ve silinmez (DOM-FIN-122, K-417): ortak `kampus_reject_immutable_change()` (migration 0013, 55000).
CREATE TRIGGER "staff_data_destructions_immutable_trigger" BEFORE UPDATE OR DELETE ON "staff_data_destructions" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "staff_data_destructions_truncate_trigger" BEFORE TRUNCATE ON "staff_data_destructions" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TABLE "staff_retention_settings" IS 'Özlük verisi saklama süresi kurum ayarı (DOM-FIN-122, ON-176, K-415): kurum ve veri kategorisi başına ayrılış sonrası saklama süresi (ay). Satırı olmayan ya da süresi boş kategori yasal en az süreyi kullanır; kurum yalnız uzatabilir (alt sınır kodda denetlenir, alt sınır yükselirse geçerli olan alt sınırdır). Yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."category" IS 'Veri kategorisi: sick_leave_reports istirahat raporları, health_reports sağlık raporu belgeleri, criminal_records adli sicil kayıtları, personnel_file özlük dosyası, leave_records izin kayıtları, payroll_records mali kayıtlar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."retention_months" IS 'Ayrılış sonrası saklama süresi (1–360 ay); boşsa yasal en az süre (platform varsayılanı). Süre kategorinin başlangıç olayından (ayrılış günü ya da ayrılış yılını izleyen yıl başı) sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."updated_by_user_id" IS 'Ayarı son yazan yönetici (kullanıcı kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."created_at" IS 'Satırın ilk yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."updated_at" IS 'Ayarın son değiştiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."archived_at" IS 'Arşiv anı; ayar arşivlenmez, ortak kolon olarak boş kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_retention_settings"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar.';
--> statement-breakpoint
COMMENT ON TABLE "staff_data_destructions" IS 'Özlük verisi imha kaydı (DOM-FIN-122, ON-176, K-417; KVKK IST-021): yöneticinin onayıyla yapılan her imha bir satırdır (kategori, yöntem, kayıt ve dosya sayısı, uygulanan süre, imha eden ve an). İmha edilen personelin kimliği, adı ve ayrılış günü yazılmaz; satır kişisel veri içermez. Satır değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."id" IS 'İmha kaydı kimliği (UUID); denetim kaydının varlık kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."category" IS 'İmha edilen veri kategorisi (staff_retention_settings.category değerleri).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."method" IS 'Yöntem (K-416): delete fiziksel silme (özlük, izin, sağlık, adli sicil), anonymize mali kayıtların kişi düzeyinde silinerek anonimleşmesi (kişisiz toplamlar kalır).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."record_count" IS 'İmha edilen kayıt sayısı (en az 1); dosyalar ayrıca sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."file_count" IS 'İmhaya işaretlenen dosya sayısı; dosya nesnesi platformun saklama sonu imhasıyla (files.purge-expired) silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."retention_months" IS 'İmha anında uygulanan saklama süresi (ay).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."start_event" IS 'Sürenin başladığı olay: separation_day ayrılış günü, year_after_separation ayrılış yılını izleyen yılın başı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."destroyed_at" IS 'İmhanın yapıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."destroyed_by_user_id" IS 'İmhayı onaylayan yönetici (kullanıcı kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."created_at" IS 'Satırın yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."updated_at" IS 'Satır değişmez; yazıldığı an.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."archived_at" IS 'Arşiv anı; imha kaydı arşivlenmez, boş kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_data_destructions"."version" IS 'Sürüm; satır değişmediği için 1 kalır.';
--> statement-breakpoint
COMMENT ON TRIGGER "staff_data_destructions_immutable_trigger" ON "staff_data_destructions" IS 'İmha kaydının değiştirilmesini ve silinmesini reddeder (DOM-FIN-122, K-417).';
