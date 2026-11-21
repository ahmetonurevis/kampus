CREATE TABLE "observation_plan_notices" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"recipient_membership_id" text NOT NULL,
	"kind" text NOT NULL,
	"planned_date" date NOT NULL,
	"start_time" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "observation_plan_notices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "observation_plan_notices_kind_check" CHECK ("observation_plan_notices"."kind" in ('scheduled', 'changed', 'postponed', 'cancelled')),
	CONSTRAINT "observation_plan_notices_status_check" CHECK ("observation_plan_notices"."status" in ('pending')),
	CONSTRAINT "observation_plan_notices_time_check" CHECK ("observation_plan_notices"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "observation_plans" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"teacher_membership_id" text NOT NULL,
	"observer_membership_id" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer DEFAULT 40 NOT NULL,
	"class_id" text,
	"class_collection" text GENERATED ALWAYS AS ('classes') STORED NOT NULL,
	"subject_id" text,
	"subject_collection" text GENERATED ALWAYS AS ('subjects') STORED NOT NULL,
	"performance_period_id" uuid,
	"note" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"postpone_count" integer DEFAULT 0 NOT NULL,
	"postpone_reason" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"observation_id" uuid,
	"done_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "observation_plans_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "observation_plans_status_check" CHECK ("observation_plans"."status" in ('planned', 'postponed', 'done', 'cancelled')),
	CONSTRAINT "observation_plans_people_check" CHECK ("observation_plans"."teacher_membership_id" <> "observation_plans"."observer_membership_id"),
	CONSTRAINT "observation_plans_time_check" CHECK ("observation_plans"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and "observation_plans"."duration_minutes" between 10 and 240
        and substr("observation_plans"."start_time", 1, 2)::int * 60 + substr("observation_plans"."start_time", 4, 2)::int
          + "observation_plans"."duration_minutes" <= 1440),
	CONSTRAINT "observation_plans_note_check" CHECK ("observation_plans"."note" is null
        or char_length("observation_plans"."note") between 1 and 1000),
	CONSTRAINT "observation_plans_reasons_check" CHECK (("observation_plans"."postpone_reason" is null
          or char_length("observation_plans"."postpone_reason") between 3 and 500)
        and ("observation_plans"."cancel_reason" is null
          or char_length("observation_plans"."cancel_reason") between 3 and 500)
        and "observation_plans"."postpone_count" >= 0
        and (("observation_plans"."postpone_count" = 0) = ("observation_plans"."postpone_reason" is null))),
	CONSTRAINT "observation_plans_cancelled_check" CHECK ((("observation_plans"."status" = 'cancelled') = ("observation_plans"."cancelled_at" is not null))
        and (("observation_plans"."cancelled_at" is null) = ("observation_plans"."cancel_reason" is null))
        and ("observation_plans"."status" <> 'cancelled' or "observation_plans"."observation_id" is null)),
	CONSTRAINT "observation_plans_done_check" CHECK ((("observation_plans"."status" = 'done') = ("observation_plans"."done_at" is not null))
        and ("observation_plans"."status" <> 'done' or "observation_plans"."observation_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "observation_plan_notices" ADD CONSTRAINT "observation_plan_notices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plan_notices" ADD CONSTRAINT "observation_plan_notices_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."observation_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plan_notices" ADD CONSTRAINT "observation_plan_notices_recipient_fkey" FOREIGN KEY ("institution_id","recipient_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_teacher_fkey" FOREIGN KEY ("institution_id","teacher_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_observer_fkey" FOREIGN KEY ("institution_id","observer_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_template_version_fkey" FOREIGN KEY ("institution_id","template_version_id") REFERENCES "public"."lesson_observation_template_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_class_fkey" FOREIGN KEY ("institution_id","class_collection","class_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_subject_fkey" FOREIGN KEY ("institution_id","subject_collection","subject_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_period_fkey" FOREIGN KEY ("institution_id","performance_period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_plans" ADD CONSTRAINT "observation_plans_observation_fkey" FOREIGN KEY ("institution_id","observation_id") REFERENCES "public"."lesson_observations"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observation_plan_notices_plan_idx" ON "observation_plan_notices" USING btree ("institution_id","plan_id");--> statement-breakpoint
CREATE INDEX "observation_plan_notices_recipient_idx" ON "observation_plan_notices" USING btree ("institution_id","recipient_membership_id");--> statement-breakpoint
CREATE INDEX "observation_plans_date_idx" ON "observation_plans" USING btree ("institution_id","planned_date");--> statement-breakpoint
CREATE INDEX "observation_plans_observer_idx" ON "observation_plans" USING btree ("institution_id","observer_membership_id","planned_date");--> statement-breakpoint
CREATE INDEX "observation_plans_teacher_idx" ON "observation_plans" USING btree ("institution_id","teacher_membership_id","planned_date");--> statement-breakpoint
CREATE INDEX "observation_plans_template_version_idx" ON "observation_plans" USING btree ("institution_id","template_version_id");--> statement-breakpoint
CREATE INDEX "observation_plans_class_idx" ON "observation_plans" USING btree ("institution_id","class_id");--> statement-breakpoint
CREATE INDEX "observation_plans_subject_idx" ON "observation_plans" USING btree ("institution_id","subject_id");--> statement-breakpoint
CREATE INDEX "observation_plans_period_idx" ON "observation_plans" USING btree ("institution_id","performance_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_plans_observation_key" ON "observation_plans" USING btree ("institution_id","observation_id") WHERE "observation_plans"."observation_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "observation_plans" IS 'Ders gözlem planı (DOM-FIN-139, ON-207): gözlenecek öğretmen ve gözlemci (kurum üyeliği, ayrı kişi), gün ve saat (Europe/Istanbul duvar saati; ders programına bağlı değildir, elle girilir), süre, form sürümü, isteğe bağlı sınıf/ders/performans dönemi. Planlandı → ertelendi → gerçekleşti ya da iptal (K-472); gözlem plandan açılır, tamamlanınca plan gerçekleşir (K-473). Gözlemci ve gözlenen çakışması ile dönem başına plan sınırı kurum kilidi altında serviste denetlenir. Yalnız yönetici yazar; yönetici ve planın öğretmenleri okur (K-474).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."id" IS 'Plan kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."teacher_membership_id" IS 'Gözlenecek öğretmenin kurum üyeliği (memberships, aynı kurum); açılışta etkin öğretmen, sonradan değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."observer_membership_id" IS 'Gözlemcinin kurum üyeliği (etkin yönetici ya da öğretmen); öğretmenden farklı kişi, aynı saatte başka planı olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."template_version_id" IS 'Gözlem formu sürümü (lesson_observation_template_versions); plan açılırken ya da form değiştirilirken son sürüm yazılır, gözlem bu sürümle açılır.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."planned_date" IS 'Plan günü; açılışta ve ertelemede bugünden (Europe/Istanbul) önce olamaz, dönem bağlıysa dönem içinde.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."start_time" IS 'Başlangıç saati SS:DD (Europe/Istanbul duvar saati, saat dilimsiz).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."duration_minutes" IS 'Süre (10–240 dakika, varsayılan bir ders saati 40); gözlem gece yarısından önce biter.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."class_id" IS 'İsteğe bağlı sınıf (records, collection ''classes'').';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."class_collection" IS 'Yabancı anahtarın koleksiyon parçası; hep ''classes'' (üretilmiş).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."subject_id" IS 'İsteğe bağlı ders (records, collection ''subjects'').';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."subject_collection" IS 'Yabancı anahtarın koleksiyon parçası; hep ''subjects'' (üretilmiş).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."performance_period_id" IS 'İsteğe bağlı performans dönemi (performance_periods, DOM-FIN-124); kapanmış döneme bağlanmaz, öğretmen başına dönemde en çok 3 iptal edilmemiş plan.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."note" IS 'Gözlemin odağı (1–1000, isteğe bağlı); öğretmen görür, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."status" IS 'Durum: planned (planlandı), postponed (ertelendi; yeni gün ve saatte açık), done (gerçekleşti; bağlı gözlem tamamlandı), cancelled (iptal).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."postpone_count" IS 'Erteleme sayısı; 0 ise erteleme gerekçesi boştur.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."postpone_reason" IS 'Son erteleme gerekçesi (3–500); loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."cancel_reason" IS 'İptal gerekçesi (3–500); yalnız iptal edilmiş planda dolu, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."cancelled_at" IS 'İptal anı (UTC); yalnız cancelled iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."observation_id" IS 'Plandan açılan gözlem (lesson_observations, aynı kurum; kurumda tekil). Taslak arşivlenirse bağ kalkar; doluyken plan değiştirilmez, ertelenmez ve iptal edilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."done_at" IS 'Gerçekleşme anı (UTC): bağlı gözlemin tamamlandığı an; yalnız done iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."created_by_user_id" IS 'Planı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."archived_at" IS 'Kullanılmaz (plan silinmez, iptal edilir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plans"."version" IS 'Satır sürümü; düzeltme, erteleme, iptal ve başlatmada If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "observation_plan_notices" IS 'Öğretmene giden gözlem planı bildirimi (DOM-FIN-139, K-474): plan açılınca, gün/saat/gözlemci değişince, ertelenince ve iptal edilince bir satır. Personele bildirim kanalı olmadığından gönderilmez, "gönderilecek" (pending) tutulur; gövde yoktur, metin gönderimde şablondan üretilir.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."id" IS 'Bildirim kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."plan_id" IS 'Konu plan (observation_plans, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."recipient_membership_id" IS 'Alıcı: planın öğretmeninin kurum üyeliği.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."kind" IS 'Konu: scheduled (planlandı), changed (gün, saat, süre ya da gözlemci değişti), postponed (ertelendi), cancelled (iptal edildi).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."planned_date" IS 'Bildirim anındaki plan günü (iptalde iptal edilen gün).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."start_time" IS 'Bildirim anındaki başlangıç saati SS:DD (Europe/Istanbul).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."status" IS 'Gönderim durumu: bugün yalnız pending (gönderilecek); kanal gelince sent/failed eklenir.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."archived_at" IS 'Kullanılmaz; zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_plan_notices"."version" IS 'Satır sürümü; gönderim kanalı durum yazarken kullanır.';
