CREATE TABLE "club_selection_choices" (
	"institution_id" text NOT NULL,
	"preference_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "club_selection_choices_pkey" PRIMARY KEY("institution_id","preference_id","rank"),
	CONSTRAINT "club_selection_choices_club_key" UNIQUE("institution_id","preference_id","club_id"),
	CONSTRAINT "club_selection_choices_rank_check" CHECK ("club_selection_choices"."rank" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "club_selection_period_clubs" (
	"institution_id" text NOT NULL,
	"period_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "club_selection_period_clubs_pkey" PRIMARY KEY("institution_id","period_id","club_id"),
	CONSTRAINT "club_selection_period_clubs_position_check" CHECK ("club_selection_period_clubs"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "club_selection_periods" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"academic_year" integer NOT NULL,
	"term" integer,
	"open_date" date NOT NULL,
	"close_date" date NOT NULL,
	"max_choices" integer NOT NULL,
	"seats_per_student" integer DEFAULT 1 NOT NULL,
	"grade_levels" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"seed" text,
	"drawn_at" timestamp with time zone,
	"drawn_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "club_selection_periods_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "club_selection_periods_name_check" CHECK (char_length("club_selection_periods"."name") between 2 and 120),
	CONSTRAINT "club_selection_periods_year_check" CHECK ("club_selection_periods"."academic_year" between 2000 and 2100),
	CONSTRAINT "club_selection_periods_term_check" CHECK ("club_selection_periods"."term" is null or "club_selection_periods"."term" in (1, 2)),
	CONSTRAINT "club_selection_periods_dates_check" CHECK ("club_selection_periods"."close_date" >= "club_selection_periods"."open_date"),
	CONSTRAINT "club_selection_periods_counts_check" CHECK ("club_selection_periods"."max_choices" between 1 and 10
        and "club_selection_periods"."seats_per_student" between 1 and 5
        and "club_selection_periods"."seats_per_student" <= "club_selection_periods"."max_choices"),
	CONSTRAINT "club_selection_periods_grades_check" CHECK ("club_selection_periods"."grade_levels" <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::integer[]),
	CONSTRAINT "club_selection_periods_draw_check" CHECK (("club_selection_periods"."seed" is null) = ("club_selection_periods"."drawn_at" is null)
        and ("club_selection_periods"."drawn_at" is null) = ("club_selection_periods"."drawn_by_user_id" is null)
        and ("club_selection_periods"."confirmed_at" is null) = ("club_selection_periods"."confirmed_by_user_id" is null)
        and ("club_selection_periods"."confirmed_at" is null or "club_selection_periods"."seed" is not null))
);
--> statement-breakpoint
CREATE TABLE "club_selection_preferences" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"entered_by_user_id" text NOT NULL,
	"entered_by_role" text NOT NULL,
	"replaced_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "club_selection_preferences_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "club_selection_preferences_period_key" UNIQUE("institution_id","period_id","id"),
	CONSTRAINT "club_selection_preferences_role_check" CHECK ("club_selection_preferences"."entered_by_role" in ('yonetici', 'onburo', 'veli', 'ogrenci')),
	CONSTRAINT "club_selection_preferences_replaced_check" CHECK (("club_selection_preferences"."archived_at" is null) = ("club_selection_preferences"."replaced_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "club_selection_results" (
	"institution_id" text NOT NULL,
	"period_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"club_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"rank" integer NOT NULL,
	"round" integer,
	"waitlist_position" integer,
	"lottery_position" integer NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "club_selection_results_pkey" PRIMARY KEY("institution_id","period_id","student_id","club_id"),
	CONSTRAINT "club_selection_results_outcome_check" CHECK ("club_selection_results"."outcome" in ('assigned', 'waitlisted')),
	CONSTRAINT "club_selection_results_shape_check" CHECK ("club_selection_results"."rank" between 1 and 10
        and "club_selection_results"."lottery_position" >= 1
        and (("club_selection_results"."outcome" = 'assigned' and "club_selection_results"."member_id" is not null
              and "club_selection_results"."round" >= 1 and "club_selection_results"."waitlist_position" is null)
          or ("club_selection_results"."outcome" = 'waitlisted' and "club_selection_results"."member_id" is null
              and "club_selection_results"."round" is null and "club_selection_results"."waitlist_position" >= 1)))
);
--> statement-breakpoint
ALTER TABLE "club_selection_choices" ADD CONSTRAINT "club_selection_choices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_choices" ADD CONSTRAINT "club_selection_choices_preference_fkey" FOREIGN KEY ("institution_id","period_id","preference_id") REFERENCES "public"."club_selection_preferences"("institution_id","period_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_choices" ADD CONSTRAINT "club_selection_choices_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_period_clubs" ADD CONSTRAINT "club_selection_period_clubs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_period_clubs" ADD CONSTRAINT "club_selection_period_clubs_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."club_selection_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_period_clubs" ADD CONSTRAINT "club_selection_period_clubs_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_periods" ADD CONSTRAINT "club_selection_periods_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_preferences" ADD CONSTRAINT "club_selection_preferences_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_preferences" ADD CONSTRAINT "club_selection_preferences_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."club_selection_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_results" ADD CONSTRAINT "club_selection_results_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_results" ADD CONSTRAINT "club_selection_results_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."club_selection_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_results" ADD CONSTRAINT "club_selection_results_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_selection_results" ADD CONSTRAINT "club_selection_results_member_fkey" FOREIGN KEY ("institution_id","member_id") REFERENCES "public"."school_club_members"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_selection_choices_period_idx" ON "club_selection_choices" USING btree ("institution_id","period_id","preference_id");--> statement-breakpoint
CREATE INDEX "club_selection_choices_club_idx" ON "club_selection_choices" USING btree ("institution_id","club_id");--> statement-breakpoint
CREATE INDEX "club_selection_period_clubs_club_idx" ON "club_selection_period_clubs" USING btree ("institution_id","club_id");--> statement-breakpoint
CREATE INDEX "club_selection_periods_year_idx" ON "club_selection_periods" USING btree ("institution_id","academic_year");--> statement-breakpoint
CREATE UNIQUE INDEX "club_selection_preferences_student_key" ON "club_selection_preferences" USING btree ("institution_id","period_id","student_id") WHERE "club_selection_preferences"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "club_selection_preferences_student_idx" ON "club_selection_preferences" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_selection_results_waitlist_key" ON "club_selection_results" USING btree ("institution_id","period_id","club_id","waitlist_position") WHERE "club_selection_results"."outcome" = 'waitlisted';--> statement-breakpoint
CREATE INDEX "club_selection_results_club_idx" ON "club_selection_results" USING btree ("institution_id","club_id");--> statement-breakpoint
CREATE INDEX "club_selection_results_member_idx" ON "club_selection_results" USING btree ("institution_id","member_id");--> statement-breakpoint
CREATE INDEX "club_selection_results_student_idx" ON "club_selection_results" USING btree ("institution_id","student_id");--> statement-breakpoint
COMMENT ON TABLE "club_selection_periods" IS 'Kulüp tercih dönemi (DOM-FIN-150, ON-169, K-505…K-507): eğitim yılı ve dönem, açılış–kapanış günü, en çok tercih ve atanacak kulüp sayısı, sınıf düzeyi süzgeci. Kura tohumu bir kez yazılır; kura sonrası dönem değişmez, onay dağıtımı kilitler.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."id" IS 'Dönem kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."name" IS 'Dönem adı (2–120).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."academic_year" IS 'Eğitim yılının başlangıç yılı (2026 → 2026–2027).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."term" IS 'Eğitim dönemi (1 ya da 2); boşsa bütün yıl.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."open_date" IS 'Tercih açılış günü (Europe/Istanbul takvim günü, dahil).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."close_date" IS 'Tercih kapanış günü (dahil); açılıştan önce olamaz. Kapanınca tercih değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."max_choices" IS 'Öğrenci başına en çok tercih (1–10); katılan kulüp sayısını aşamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."seats_per_student" IS 'Öğrenci başına atanacak kulüp sayısı (1–5, varsayılan 1); tercih sayısını aşamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."grade_levels" IS 'Hedef sınıf düzeyleri (1–12); boş dizi bütün öğrenciler.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."seed" IS 'Kura tohumu; bir kez yazılır, dağıtım aynı tohumla yeniden üretilir.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."drawn_at" IS 'Kuranın çekildiği an; tohumla birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."drawn_by_user_id" IS 'Kurayı çeken kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."confirmed_at" IS 'Dağıtımın onaylandığı an; üyelikler aynı işlemde yazılır, ikinci onay yok.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."confirmed_by_user_id" IS 'Dağıtımı onaylayan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."created_by_user_id" IS 'Dönemi açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."archived_at" IS 'Arşiv anı; arşivli dönem listelenmez, yazılan üyelikler kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_periods"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "club_selection_period_clubs" IS 'Döneme katılan kulüpler (DOM-FIN-150, K-505). Kulüp listesi yalnız tercih girilmemiş dönemde değişir; çıkarılan kulüp arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."period_id" IS 'Tercih dönemi (club_selection_periods FK).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."club_id" IS 'Kulüp (school_clubs FK).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."position" IS 'Gösterim sırası (1…).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."archived_at" IS 'Kulüp dönemden çıkarıldıysa arşiv anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_period_clubs"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "club_selection_preferences" IS 'Öğrencinin dönemdeki tercihi (DOM-FIN-150, K-505): dönemde öğrenci başına tek etkin tercih (club_selection_preferences_student_key). Değişiklik eskisini arşivleyip yenisini yazar; geri çekme arşivdir.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."id" IS 'Tercih kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."period_id" IS 'Tercih dönemi (club_selection_periods FK).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."student_id" IS 'Öğrencinin records kimliği (kişisel veri); kurumun etkin öğrencisi ve hedef düzeyde olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."entered_by_user_id" IS 'Tercihi giren kullanıcı (öğrenci, veli ya da adına giren yönetici/ön büro).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."entered_by_role" IS 'Tercihi girenin rolü: yonetici, onburo, veli, ogrenci.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."replaced_by_user_id" IS 'Tercihi değiştiren ya da geri çeken kullanıcı; arşivle birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."archived_at" IS 'Tercih değiştirildiyse ya da geri çekildiyse arşiv anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_preferences"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "club_selection_choices" IS 'Tercihin sıralı kulüpleri (DOM-FIN-150, K-505): sıra ve kulüp tercih içinde tekildir; satırlar tercihle birlikte yazılır, değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."preference_id" IS 'Tercih (club_selection_preferences FK, dönemle birlikte).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."period_id" IS 'Tercih dönemi (kopya); tercihin aynı döneme ait olmasını yabancı anahtarla güvenceler.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."rank" IS 'Tercih sırası (1 ilk tercih … 10).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."club_id" IS 'Tercih edilen kulüp (school_clubs FK); dönemin kulübü olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."archived_at" IS 'Kullanılmaz; tercih başlığı arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_choices"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "club_selection_results" IS 'Onaylanan dağıtım sonucu (DOM-FIN-150, K-506, K-507): öğrenci × kulüp. Atananın üyeliği onayla aynı işlemde school_club_members tablosuna yazılır; yerleşemeyen öğrenci kulüp başına sıralı yedek listesindedir. Yer açılınca ilk bekleyen yedek önerilir, otomatik eklenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."period_id" IS 'Tercih dönemi (club_selection_periods FK).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."student_id" IS 'Öğrencinin records kimliği (kişisel veri).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."club_id" IS 'Kulüp (school_clubs FK).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."outcome" IS 'Sonuç: assigned (atandı, üyelik yazıldı) ya da waitlisted (yedek).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."rank" IS 'Kulübün öğrencinin tercihindeki sırası (1…).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."round" IS 'Atamanın yapıldığı tur (yılan sırası); yalnız atananda.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."waitlist_position" IS 'Kulübün yedek listesindeki sıra (tercih sırası, sonra kura sırası); yalnız yedekte.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."lottery_position" IS 'Öğrencinin kura sırası (1…).';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."member_id" IS 'Onayda yazılan kulüp üyeliği (school_club_members FK); yalnız atananda.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."archived_at" IS 'Kullanılmaz; sonuç değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "club_selection_results"."version" IS 'İyimser kilit sürümü (If-Match).';
