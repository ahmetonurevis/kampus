CREATE TABLE "school_calendar_events" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"all_day" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"location" text,
	"description" text,
	"audience_kind" text NOT NULL,
	"audience_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "school_calendar_events_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "school_calendar_events_kind_check" CHECK ("school_calendar_events"."kind" in ('ceremony', 'parent_meeting', 'exam_week', 'holiday', 'trip', 'performance', 'other')),
	CONSTRAINT "school_calendar_events_status_check" CHECK ("school_calendar_events"."status" in ('draft', 'published', 'cancelled')),
	CONSTRAINT "school_calendar_events_audience_kind_check" CHECK ("school_calendar_events"."audience_kind" in ('institution', 'grade', 'class', 'group')),
	CONSTRAINT "school_calendar_events_title_check" CHECK (char_length("school_calendar_events"."title") between 2 and 120),
	CONSTRAINT "school_calendar_events_text_check" CHECK (("school_calendar_events"."location" is null or char_length("school_calendar_events"."location") between 1 and 160)
        and ("school_calendar_events"."description" is null or char_length("school_calendar_events"."description") between 1 and 2000)),
	CONSTRAINT "school_calendar_events_dates_check" CHECK ("school_calendar_events"."end_date" >= "school_calendar_events"."start_date"),
	CONSTRAINT "school_calendar_events_times_check" CHECK (case when "school_calendar_events"."all_day"
        then "school_calendar_events"."start_time" is null and "school_calendar_events"."end_time" is null
        else "school_calendar_events"."start_time" is not null and "school_calendar_events"."end_time" is not null
          and "school_calendar_events"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and "school_calendar_events"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and ("school_calendar_events"."end_date" > "school_calendar_events"."start_date" or "school_calendar_events"."end_time" > "school_calendar_events"."start_time")
        end),
	CONSTRAINT "school_calendar_events_all_day_kind_check" CHECK ("school_calendar_events"."all_day" or "school_calendar_events"."kind" not in ('holiday', 'exam_week')),
	CONSTRAINT "school_calendar_events_audience_check" CHECK (("school_calendar_events"."audience_kind" = 'institution') = (cardinality("school_calendar_events"."audience_ids") = 0)
        and cardinality("school_calendar_events"."audience_ids") <= 40),
	CONSTRAINT "school_calendar_events_published_check" CHECK (("school_calendar_events"."status" <> 'draft' or "school_calendar_events"."published_at" is null)
        and ("school_calendar_events"."status" <> 'published' or "school_calendar_events"."published_at" is not null)
        and ("school_calendar_events"."published_at" is null) = ("school_calendar_events"."published_by_user_id" is null)),
	CONSTRAINT "school_calendar_events_cancelled_check" CHECK (("school_calendar_events"."status" = 'cancelled') = ("school_calendar_events"."cancelled_at" is not null)
        and ("school_calendar_events"."cancelled_at" is null) = ("school_calendar_events"."cancelled_by_user_id" is null)
        and ("school_calendar_events"."cancelled_at" is null) = ("school_calendar_events"."cancel_reason" is null)
        and ("school_calendar_events"."cancel_reason" is null or char_length("school_calendar_events"."cancel_reason") between 10 and 500))
);
--> statement-breakpoint
ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_calendar_events_range_idx" ON "school_calendar_events" USING btree ("institution_id","start_date","end_date") WHERE "school_calendar_events"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "school_calendar_events" IS 'Okul etkinlik takvimi (DOM-FIN-163, ON-090, IST-099, K-544…K-546): tören, veli toplantısı, sınav haftası, tatil, gezi, gösteri ve diğer etkinlikler. Taslak yalnız yönetici ve ön büroda görünür; yayımlanan etkinlik hedef kitleye (tüm kurum, kademe, sınıf ya da grup) görünür. Silinmez, gerekçeyle iptal edilir. Yayımlanmış, tüm kurum hedefli tatil kurumun tatilidir ve izin takvimi tatili buradan okur (K-545). Gezi planı ve biletli etkinlik buraya kopyalanmaz, okumada bağlantı olarak eklenir (K-546).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."id" IS 'Etkinlik kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."title" IS 'Etkinlik başlığı (2–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."kind" IS 'Tür: ceremony (tören), parent_meeting (veli toplantısı), exam_week (sınav haftası), holiday (tatil), trip (gezi), performance (gösteri), other (diğer). Tatil ve sınav haftası tüm gündür.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."all_day" IS 'Tüm gün mü; doğruysa saat kolonları boştur.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."start_date" IS 'Başlangıç günü (Europe/Istanbul takvim günü).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."end_date" IS 'Bitiş günü (dahil; Europe/Istanbul); başlangıçtan önce olamaz, etkinlik en çok 120 gün sürer (core kuralı).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."start_time" IS 'Başlangıç saati (SS:DD, İstanbul duvar saati); yalnız tüm gün olmayan etkinlikte.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."end_time" IS 'Bitiş saati (SS:DD, İstanbul duvar saati); tek günlük etkinlikte başlangıçtan sonradır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."location" IS 'Yer (en çok 160 karakter); girilmediyse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."description" IS 'Açıklama (en çok 2000 karakter); hedef kitle görür. Loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."audience_kind" IS 'Hedef kitle: institution (tüm kurum), grade (kademe = sınıf düzeyi), class (sınıf), group (dil okulu grubu).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."audience_ids" IS 'Hedef kimlikleri: kademede sınıf düzeyleri ("7"), sınıfta records classes kimlikleri, grupta language_groups kimlikleri; tüm kurumda boş, en çok 40. Yabancı anahtar değildir, yazarken core kuralıyla denetlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."status" IS 'Durum: draft (taslak, yalnız yönetici ve ön büro görür), published (yayımlandı), cancelled (iptal edildi).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."published_at" IS 'Yayım anı (UTC); taslakta boş, iptal edilen yayımlanmış etkinlikte korunur (hedef kitle iptali görür).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."published_by_user_id" IS 'Yayımlayan kullanıcı (Better Auth kullanıcı kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."cancelled_at" IS 'İptal anı (UTC); yalnız iptal edilen etkinlikte.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."cancelled_by_user_id" IS 'İptal eden kullanıcı (Better Auth kullanıcı kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."cancel_reason" IS 'İptal gerekçesi (10–500 karakter); hedef kitle görür. Loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."created_by_user_id" IS 'Etkinliği açan kullanıcı (Better Auth kullanıcı kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."created_at" IS 'Oluşturma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."archived_at" IS 'Arşiv anı; etkinlik silinmediğinden arşiv yolu yoktur, boş kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_calendar_events"."version" IS 'İyimser kilit sürümü (If-Match); her düzenleme, yayım ve iptalde artar. iCal SEQUENCE değeri olarak da kullanılır.';
