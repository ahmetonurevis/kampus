-- Eğitim yılı ve dönemleri (OG-023, IST-011; DOM-YTK-063…067). Yıl kurum içinde başlangıç yılıyla
-- tanımlanır (birincil anahtar), mevcut `academic_year` sayılarıyla aynı değerdir. Tablolar yenidir;
-- kısıtlar `not valid` adımı olmadan tek adımda eklenir. Yılların ve dönemlerin örtüşmemesi core
-- kuralıyla kurum kilidi altında denetlenir (aralık kısıtı `btree_gist` ister, kurulu değil). Dönem
-- adı tekilliği core `academicTermNameKey` anahtarı (`name_key`) üzerindedir.
CREATE TABLE "academic_terms" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"start_year" integer NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "academic_terms_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "academic_terms_name_check" CHECK (char_length("academic_terms"."name") between 1 and 100),
	CONSTRAINT "academic_terms_dates_check" CHECK ("academic_terms"."end_date" >= "academic_terms"."start_date")
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"institution_id" text NOT NULL,
	"start_year" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "academic_years_pkey" PRIMARY KEY("institution_id","start_year"),
	CONSTRAINT "academic_years_start_year_check" CHECK ("academic_years"."start_year" between 2000 and 2100),
	CONSTRAINT "academic_years_status_check" CHECK ("academic_years"."status" in ('planned', 'active', 'closed')),
	CONSTRAINT "academic_years_dates_check" CHECK (extract(year from "academic_years"."start_date") = "academic_years"."start_year"
        and "academic_years"."end_date" > "academic_years"."start_date"
        and "academic_years"."end_date" < "academic_years"."start_date" + interval '1 year'),
	CONSTRAINT "academic_years_lifecycle_check" CHECK (("academic_years"."status" = 'planned' and "academic_years"."activated_at" is null and "academic_years"."closed_at" is null)
        or ("academic_years"."status" = 'active' and "academic_years"."activated_at" is not null and "academic_years"."closed_at" is null)
        or ("academic_years"."status" = 'closed' and "academic_years"."activated_at" is not null and "academic_years"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_year_fkey" FOREIGN KEY ("institution_id","start_year") REFERENCES "public"."academic_years"("institution_id","start_year") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_year_name_key" ON "academic_terms" USING btree ("institution_id","start_year","name_key") WHERE "academic_terms"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "academic_terms_year_idx" ON "academic_terms" USING btree ("institution_id","start_year","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_active_key" ON "academic_years" USING btree ("institution_id") WHERE "academic_years"."status" = 'active' and "academic_years"."archived_at" is null;--> statement-breakpoint
-- Geri doldurma (elle eklendi): ayar satırı olan her kurumun güncel yılı (`institution_settings
-- .academic_year`) varsayılan aralıkla (1 Eylül – 31 Ağustos), dönemsiz ve etkin açılır; böylece
-- `/current` mevcut kurumlarda boş dönmez. Kurum açılışı aynı yılı `ensureInstitutionSettings` ile
-- yazar. Okulun dönemlerini yönetici ekler (dönem şartı etkinleştirme işlemine aittir).
INSERT INTO "academic_years" ("institution_id", "start_year", "start_date", "end_date", "status", "activated_at")
SELECT "institution_id", "academic_year", make_date("academic_year", 9, 1),
	make_date("academic_year" + 1, 8, 31), 'active', now()
FROM "institution_settings";
