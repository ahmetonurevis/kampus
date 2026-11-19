CREATE TABLE "professional_development_enrollments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"attended_minutes" integer,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "professional_development_enrollments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "professional_development_enrollments_origin_check" CHECK ("professional_development_enrollments"."origin" in ('request', 'assignment')),
	CONSTRAINT "professional_development_enrollments_status_check" CHECK ("professional_development_enrollments"."status" in ('assigned', 'attended', 'not_completed')),
	CONSTRAINT "professional_development_enrollments_attended_check" CHECK ((("professional_development_enrollments"."status" = 'attended') = ("professional_development_enrollments"."attended_minutes" is not null))
        and ("professional_development_enrollments"."attended_minutes" is null or ("professional_development_enrollments"."attended_minutes" > 0 and "professional_development_enrollments"."attended_minutes" % 30 = 0)))
);
--> statement-breakpoint
CREATE TABLE "professional_development_programs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"ongoing" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"location" text,
	"online_url" text,
	"audience_roles" jsonb NOT NULL,
	"audience_branches" jsonb NOT NULL,
	"fee_cents" bigint,
	"cost_center_id" uuid,
	"capacity" integer,
	"status" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "professional_development_programs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "professional_development_programs_kind_check" CHECK ("professional_development_programs"."kind" in ('course', 'seminar', 'conference', 'in_house', 'online')),
	CONSTRAINT "professional_development_programs_status_check" CHECK ("professional_development_programs"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "professional_development_programs_text_check" CHECK (char_length("professional_development_programs"."name") between 2 and 160
        and char_length("professional_development_programs"."provider") between 2 and 160
        and ("professional_development_programs"."location" is null or char_length("professional_development_programs"."location") between 1 and 200)
        and ("professional_development_programs"."online_url" is null or (char_length("professional_development_programs"."online_url") <= 500 and "professional_development_programs"."online_url" like 'https://%'))
        and ("professional_development_programs"."location" is not null or "professional_development_programs"."online_url" is not null)),
	CONSTRAINT "professional_development_programs_duration_check" CHECK ("professional_development_programs"."duration_minutes" > 0 and "professional_development_programs"."duration_minutes" <= 120000 and "professional_development_programs"."duration_minutes" % 30 = 0),
	CONSTRAINT "professional_development_programs_dates_check" CHECK (("professional_development_programs"."ongoing" and "professional_development_programs"."start_date" is null and "professional_development_programs"."end_date" is null)
        or (not "professional_development_programs"."ongoing" and "professional_development_programs"."start_date" is not null and "professional_development_programs"."end_date" is not null
          and "professional_development_programs"."end_date" >= "professional_development_programs"."start_date")),
	CONSTRAINT "professional_development_programs_fee_check" CHECK (("professional_development_programs"."fee_cents" is null or "professional_development_programs"."fee_cents" between 0 and 100000000)
        and ("professional_development_programs"."cost_center_id" is null or "professional_development_programs"."fee_cents" is not null)),
	CONSTRAINT "professional_development_programs_capacity_check" CHECK ("professional_development_programs"."capacity" is null or "professional_development_programs"."capacity" between 1 and 10000),
	CONSTRAINT "professional_development_programs_audience_check" CHECK (jsonb_typeof("professional_development_programs"."audience_roles") = 'array' and jsonb_typeof("professional_development_programs"."audience_branches") = 'array')
);
--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_program_fkey" FOREIGN KEY ("institution_id","program_id") REFERENCES "public"."professional_development_programs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_enrollments" ADD CONSTRAINT "professional_development_enrollments_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_programs" ADD CONSTRAINT "professional_development_programs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_development_programs" ADD CONSTRAINT "professional_development_programs_cost_center_fkey" FOREIGN KEY ("institution_id","cost_center_id") REFERENCES "public"."cost_centers"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_development_enrollments_member_key" ON "professional_development_enrollments" USING btree ("institution_id","program_id","membership_id");--> statement-breakpoint
CREATE INDEX "professional_development_enrollments_membership_idx" ON "professional_development_enrollments" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "professional_development_programs_status_idx" ON "professional_development_programs" USING btree ("institution_id","status","start_date");--> statement-breakpoint
CREATE INDEX "professional_development_programs_cost_center_idx" ON "professional_development_programs" USING btree ("institution_id","cost_center_id");
--> statement-breakpoint
COMMENT ON TABLE "professional_development_programs" IS 'Mesleki gelişim kataloğu (DOM-FIN-125, ON-214, K-430/K-431): personele açılan kurs, seminer, konferans, kurum içi ve çevrim içi eğitimler. Durum taslak → yayında → arşiv; arşiv son durumdur ve satır değişmez. Satır silinmez. Yönetici yazar, yönetici ve ön büro okur.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."id" IS 'Eğitim kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."name" IS 'Eğitimin adı (2–160).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."kind" IS 'Tür: course (kurs), seminar (seminer), conference (konferans), in_house (kurum içi eğitim), online (çevrim içi; bağlantı zorunlu).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."provider" IS 'Eğitimi veren kurum ya da kişi (2–160); kurum içi eğitimde kurumun kendisi.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."duration_minutes" IS 'Toplam süre, dakika; arayüzde saat, yarım saat adımlı (30 un katı, en çok 2000 saat).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."ongoing" IS 'Sürekli açık eğitim (kendi hızında); doğruysa tarih aralığı boştur.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."start_date" IS 'Başlangıç günü; sürekli eğitimde boş, değilse zorunlu.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."end_date" IS 'Bitiş günü; başlangıçtan önce olamaz, sürekli eğitimde boş.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."location" IS 'Yüz yüze eğitimin yeri (isteğe bağlı); yer ya da bağlantıdan en az biri dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."online_url" IS 'Çevrim içi bağlantı (https://, en çok 500 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."audience_roles" IS 'Hedef kitle rol etiketleri (jsonb dizi: yonetici, ogretmen, onburo); boş dizi tüm personel.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."audience_branches" IS 'Hedef kitle branş etiketleri (jsonb dizi, serbest metin, en çok 10).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."fee_cents" IS 'Kişi başı ücret, kuruş (isteğe bağlı); boşsa ücretsiz ya da bilinmiyor.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."cost_center_id" IS 'Ücretin yazılacağı maliyet merkezi (cost_centers, aynı kurum; ON-204); yalnız ücret girilmişse.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."capacity" IS 'Kontenjan (1–10000); boşsa sınırsız. Atama sayısı kontenjanı aşamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."status" IS 'Durum: draft (taslak), published (yayında; atama yalnız bu durumda), archived (arşiv; değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."created_by_user_id" IS 'Eğitimi kataloğa ekleyen yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."archived_at" IS 'Kullanılmaz (satır silinmez, eğitim durumla arşivlenir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_programs"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "professional_development_enrollments" IS 'Personelin mesleki gelişim eğitimine ataması ya da katılım isteği (DOM-FIN-125, ON-214, K-432). Personel kurum üyeliğidir (ayrı personel tablosu yok); aynı personel aynı eğitime bir kez. Durum atandı, katıldı ya da tamamlamadı; katılım saati yalnız katıldı durumunda. Sertifika (ON-215) burada tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."id" IS 'Atama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."program_id" IS 'Eğitim (professional_development_programs, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."membership_id" IS 'Atanan personelin kurum üyeliği (memberships, aynı kurum; kişisel veri). Etkin yönetici, öğretmen ya da ön büro.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."origin" IS 'Kaynak: request (personelin katılım isteği), assignment (yönetici ataması).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."status" IS 'Durum: assigned (atandı), attended (katıldı), not_completed (tamamlamadı).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."attended_minutes" IS 'Katılım süresi, dakika (30 un katı); yalnız attended durumunda ve zorunlu, eğitim süresini aşamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."status_changed_at" IS 'Durumun son değiştiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."created_by_user_id" IS 'Atamayı kaydeden yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."archived_at" IS 'Kullanılmaz (satır silinmez, eğitim durumla arşivlenir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "professional_development_enrollments"."version" IS 'İyimser kilit sürümü (If-Match).';
