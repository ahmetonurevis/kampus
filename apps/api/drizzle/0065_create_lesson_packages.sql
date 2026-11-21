CREATE TABLE "lesson_package_hour_entries" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"hours" integer NOT NULL,
	"occurred_date" date NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_package_hour_entries_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_package_hour_entries_kind_check" CHECK ("lesson_package_hour_entries"."kind" in ('consumed', 'refunded')),
	CONSTRAINT "lesson_package_hour_entries_source_check" CHECK ("lesson_package_hour_entries"."source_type" in ('lesson', 'withdrawal')),
	CONSTRAINT "lesson_package_hour_entries_hours_check" CHECK ("lesson_package_hour_entries"."hours" between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "lesson_package_sales" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"kind" text NOT NULL,
	"course_id" uuid,
	"level" text,
	"student_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"tariff_id" uuid NOT NULL,
	"tariff_version" integer NOT NULL,
	"purchased_hours" integer NOT NULL,
	"hourly_cents" bigint NOT NULL,
	"gross_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"expires_date" date,
	"sold_at" timestamp with time zone NOT NULL,
	"sold_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_package_sales_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_package_sales_kind_check" CHECK ("lesson_package_sales"."kind" in ('course', 'hours', 'private')),
	CONSTRAINT "lesson_package_sales_level_check" CHECK ("lesson_package_sales"."level" is null or "lesson_package_sales"."level" in ('Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2')),
	CONSTRAINT "lesson_package_sales_hours_check" CHECK ("lesson_package_sales"."purchased_hours" between 1 and 2000),
	CONSTRAINT "lesson_package_sales_amounts_check" CHECK ("lesson_package_sales"."hourly_cents" > 0 and "lesson_package_sales"."gross_cents" > 0 and "lesson_package_sales"."net_cents" > 0 and "lesson_package_sales"."net_cents" <= "lesson_package_sales"."gross_cents"),
	CONSTRAINT "lesson_package_sales_currency_check" CHECK ("lesson_package_sales"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "lesson_packages" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"course_id" uuid,
	"level" text,
	"lesson_hours" integer,
	"hourly_cents" bigint,
	"validity_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_packages_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_packages_kind_check" CHECK ("lesson_packages"."kind" in ('course', 'hours', 'private')),
	CONSTRAINT "lesson_packages_level_check" CHECK ("lesson_packages"."level" is null or "lesson_packages"."level" in ('Pre-A1', 'A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2')),
	CONSTRAINT "lesson_packages_hours_check" CHECK ("lesson_packages"."lesson_hours" is null or "lesson_packages"."lesson_hours" between 1 and 2000),
	CONSTRAINT "lesson_packages_course_kind_check" CHECK ("lesson_packages"."kind" <> 'course' or ("lesson_packages"."course_id" is not null and "lesson_packages"."lesson_hours" is null)),
	CONSTRAINT "lesson_packages_hours_kind_check" CHECK ("lesson_packages"."kind" = 'course' or "lesson_packages"."lesson_hours" is not null),
	CONSTRAINT "lesson_packages_hourly_check" CHECK ("lesson_packages"."hourly_cents" is null or "lesson_packages"."hourly_cents" > 0),
	CONSTRAINT "lesson_packages_validity_check" CHECK ("lesson_packages"."validity_days" is null or "lesson_packages"."validity_days" between 1 and 1825)
);
--> statement-breakpoint
ALTER TABLE "lesson_package_hour_entries" ADD CONSTRAINT "lesson_package_hour_entries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_hour_entries" ADD CONSTRAINT "lesson_package_hour_entries_sale_fkey" FOREIGN KEY ("institution_id","sale_id") REFERENCES "public"."lesson_package_sales"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_sales" ADD CONSTRAINT "lesson_package_sales_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_sales" ADD CONSTRAINT "lesson_package_sales_package_fkey" FOREIGN KEY ("institution_id","package_id") REFERENCES "public"."lesson_packages"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_sales" ADD CONSTRAINT "lesson_package_sales_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_sales" ADD CONSTRAINT "lesson_package_sales_contract_fkey" FOREIGN KEY ("institution_id","contract_id") REFERENCES "public"."contracts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_package_sales" ADD CONSTRAINT "lesson_package_sales_tariff_fkey" FOREIGN KEY ("institution_id","tariff_id") REFERENCES "public"."fee_tariffs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_packages" ADD CONSTRAINT "lesson_packages_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_packages" ADD CONSTRAINT "lesson_packages_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_package_hour_entries_source_key" ON "lesson_package_hour_entries" USING btree ("institution_id","sale_id","source_type","source_id") WHERE "lesson_package_hour_entries"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "lesson_package_hour_entries_sale_idx" ON "lesson_package_hour_entries" USING btree ("institution_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_package_sales_contract_key" ON "lesson_package_sales" USING btree ("institution_id","contract_id");--> statement-breakpoint
CREATE INDEX "lesson_package_sales_student_idx" ON "lesson_package_sales" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "lesson_package_sales_package_idx" ON "lesson_package_sales" USING btree ("institution_id","package_id");--> statement-breakpoint
CREATE INDEX "lesson_package_sales_tariff_idx" ON "lesson_package_sales" USING btree ("institution_id","tariff_id");--> statement-breakpoint
CREATE INDEX "lesson_package_sales_course_idx" ON "lesson_package_sales" USING btree ("institution_id","course_id") WHERE "lesson_package_sales"."course_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_packages_name_key" ON "lesson_packages" USING btree ("institution_id","name_key") WHERE "lesson_packages"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "lesson_packages_course_idx" ON "lesson_packages" USING btree ("institution_id","course_id") WHERE "lesson_packages"."course_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "lesson_packages" IS 'Dil okulu paket tanımı (IST-078, DOM-DIL-050): kur ücreti, saat paketi, özel ders paketi. Tutar taşımaz; fiyat satış anında yayımlı tarifeden hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."id" IS 'Paket kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."kind" IS 'Paket türü: course (kur ücreti), hours (saat paketi), private (özel ders paketi).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."name" IS 'Paketin görünen adı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."name_key" IS 'Ad tekilliği anahtarı (core packageNameKey); arşivlenmemiş paketlerde kurum içinde tekildir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."course_id" IS 'Bağlı kur; kur ücreti paketinde zorunlu, satışta kurun etkin olması aranır (DOM-DIL-006).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."level" IS 'Tarife düzeyi (CEFR); kura bağlı pakette boştur, seviye kurdan okunur.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."lesson_hours" IS 'Paketin ders saati; kur ücreti paketinde boştur, saat kurdan okunur.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."hourly_cents" IS 'İlan altı saat ücreti, kuruş; boşsa tarifenin saat ücreti uygulanır, ilan üstü satışta reddedilir (DOM-DIL-050).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."validity_days" IS 'Kullanım süresi, gün; boşsa son kullanma tarihi yoktur (DOM-DIL-051).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."archived_at" IS 'Arşivlenme anı; arşivli paket satılamaz, geçmiş satışları kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_packages"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "lesson_package_sales" IS 'Paket satışı (IST-078): paketin ve fiyatın karar anı kopyası. Sözleşme ve taksitlerle tek işlemde yazılır; bakiye saklanmaz, saat hareketlerinden hesaplanır (DOM-DIL-051).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."id" IS 'Satış kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."package_id" IS 'Satılan paket; satış varken paket kalıcı silinemez.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."package_name" IS 'Satış anındaki paket adı; paket sonradan değişse de kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."kind" IS 'Satış anındaki paket türü.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."course_id" IS 'Satış anındaki kur bağı; boş olabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."level" IS 'Satış anındaki seviye; kurdan ya da paketten kopyalanır (DOM-DIL-006).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."student_id" IS 'Kursiyer; records students kimliği, yabancı anahtar değildir (ADR 0010 karar 6).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."contract_id" IS 'Satışın açtığı sözleşme sürümü; her satışın kendi sözleşmesi vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."tariff_id" IS 'Fiyatın hesaplandığı yayımlı tarife (DOM-FIN-002).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."tariff_version" IS 'Satış anındaki tarife sürümü.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."purchased_hours" IS 'Satın alınan ders saati; bakiyenin başlangıcı (DOM-DIL-051).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."hourly_cents" IS 'Uygulanan saat ücreti, kuruş; iade bu ücretle hesaplanır (DOM-FIN-006).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."gross_cents" IS 'İndirimsiz öğrenim ücreti, kuruş: saat × uygulanan saat ücreti.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."net_cents" IS 'İndirimden sonra öğrenim ücreti, kuruş; indirim dökümü sözleşmededir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."currency" IS 'Para birimi; yalnız TRY (DOM-FIN-001).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."expires_date" IS 'Son kullanma günü (Europe/Istanbul); boşsa süresizdir. Dolunca saat silinmez, yeni tüketim durur (DOM-DIL-051, H-19 doğrulanmalı).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."sold_at" IS 'Satış anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."sold_by_user_id" IS 'Satışı yapan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."archived_at" IS 'Arşivlenme anı; boşsa etkindir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_sales"."version" IS 'İyimser kilit sürümü (If-Match); süre uzatmada artar.';
--> statement-breakpoint
COMMENT ON TABLE "lesson_package_hour_entries" IS 'Paket saat hareketi (DOM-DIL-051): bakiye bu satırlardan hesaplanır. Kaynak başına tek etkin satır; yoklama ya da ayrılış yeniden işlenince saat iki kez düşmez.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."id" IS 'Hareket kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."sale_id" IS 'Hareketin bağlı olduğu satış.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."kind" IS 'Hareket türü: consumed (tüketilen), refunded (iade edilen).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."hours" IS 'Ders saati; sıfırdan büyük, bakiyeyi aşamaz (kurum kilidi altında core denetler).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."occurred_date" IS 'Dersin ya da iadenin günü; gelecekte olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."source_type" IS 'Kaynak türü: lesson (ders), withdrawal (ayrılış).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."source_id" IS 'Kaynak kaydın kimliği; tekrar yazımı önler.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."recorded_by_user_id" IS 'Hareketi yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."created_at" IS 'Oluşturulma anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."archived_at" IS 'Arşivlenme anı; yanlış hareket arşivlenir, bakiyeye girmez.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_package_hour_entries"."version" IS 'İyimser kilit sürümü.';