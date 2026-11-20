CREATE TABLE "lesson_observation_template_versions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_observation_template_versions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_observation_template_versions_name_check" CHECK (char_length("lesson_observation_template_versions"."name") between 2 and 120),
	CONSTRAINT "lesson_observation_template_versions_criteria_check" CHECK (jsonb_typeof("lesson_observation_template_versions"."criteria") = 'array'
        and jsonb_array_length("lesson_observation_template_versions"."criteria") between 1 and 10),
	CONSTRAINT "lesson_observation_template_versions_number_check" CHECK ("lesson_observation_template_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson_observation_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"latest_version_number" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_observation_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_observation_templates_latest_check" CHECK ("lesson_observation_templates"."latest_version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson_observations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"teacher_membership_id" text NOT NULL,
	"observer_membership_id" text NOT NULL,
	"observed_date" date NOT NULL,
	"class_id" text,
	"class_collection" text GENERATED ALWAYS AS ('classes') STORED NOT NULL,
	"subject_id" text,
	"subject_collection" text GENERATED ALWAYS AS ('subjects') STORED NOT NULL,
	"performance_period_id" uuid,
	"ratings" jsonb NOT NULL,
	"general_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_observations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "lesson_observations_status_check" CHECK ("lesson_observations"."status" in ('draft', 'completed')),
	CONSTRAINT "lesson_observations_ratings_check" CHECK (jsonb_typeof("lesson_observations"."ratings") = 'array'
        and jsonb_array_length("lesson_observations"."ratings") between 1 and 10),
	CONSTRAINT "lesson_observations_note_check" CHECK ("lesson_observations"."general_note" is null
        or char_length("lesson_observations"."general_note") between 1 and 4000),
	CONSTRAINT "lesson_observations_completed_check" CHECK ((("lesson_observations"."status" = 'completed') = ("lesson_observations"."completed_at" is not null))
        and (("lesson_observations"."completed_at" is null) = ("lesson_observations"."completed_by_user_id" is null))
        and ("lesson_observations"."status" = 'draft' or "lesson_observations"."general_note" is not null)),
	CONSTRAINT "lesson_observations_people_check" CHECK ("lesson_observations"."teacher_membership_id" <> "lesson_observations"."observer_membership_id")
);
--> statement-breakpoint
ALTER TABLE "lesson_observation_template_versions" ADD CONSTRAINT "lesson_observation_template_versions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observation_template_versions" ADD CONSTRAINT "lesson_observation_template_versions_template_fkey" FOREIGN KEY ("institution_id","template_id") REFERENCES "public"."lesson_observation_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observation_templates" ADD CONSTRAINT "lesson_observation_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_template_version_fkey" FOREIGN KEY ("institution_id","template_version_id") REFERENCES "public"."lesson_observation_template_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_teacher_fkey" FOREIGN KEY ("institution_id","teacher_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_observer_fkey" FOREIGN KEY ("institution_id","observer_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_class_fkey" FOREIGN KEY ("institution_id","class_collection","class_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_subject_fkey" FOREIGN KEY ("institution_id","subject_collection","subject_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_period_fkey" FOREIGN KEY ("institution_id","performance_period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_observation_template_versions_number_key" ON "lesson_observation_template_versions" USING btree ("institution_id","template_id","version_number");--> statement-breakpoint
CREATE INDEX "lesson_observations_date_idx" ON "lesson_observations" USING btree ("institution_id","observed_date");--> statement-breakpoint
CREATE INDEX "lesson_observations_template_version_idx" ON "lesson_observations" USING btree ("institution_id","template_version_id");--> statement-breakpoint
CREATE INDEX "lesson_observations_teacher_idx" ON "lesson_observations" USING btree ("institution_id","teacher_membership_id");--> statement-breakpoint
CREATE INDEX "lesson_observations_observer_idx" ON "lesson_observations" USING btree ("institution_id","observer_membership_id");--> statement-breakpoint
CREATE INDEX "lesson_observations_class_idx" ON "lesson_observations" USING btree ("institution_id","class_id");--> statement-breakpoint
CREATE INDEX "lesson_observations_subject_idx" ON "lesson_observations" USING btree ("institution_id","subject_id");--> statement-breakpoint
CREATE INDEX "lesson_observations_period_idx" ON "lesson_observations" USING btree ("institution_id","performance_period_id");--> statement-breakpoint
COMMENT ON TABLE "lesson_observation_templates" IS 'Ders gözlem formu şablonu (DOM-FIN-130, ON-206): kimlik ve arşiv. Ad ve ölçütler sürümdedir (lesson_observation_template_versions); gözlemde kullanılmış sürüm değişmez, yeni sürüm açılır (K-445). Yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."id" IS 'Şablon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."latest_version_number" IS 'Son sürüm numarası; yeni gözlem bu sürümü kullanır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."created_by_user_id" IS 'Şablonu açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."archived_at" IS 'Arşiv anı; arşivli şablon yeni gözlemde seçilmez ve değişmez, eski gözlemler sürümüyle okunur.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_templates"."version" IS 'Satır sürümü; düzeltme, yeni sürüm ve arşivde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "lesson_observation_template_versions" IS 'Gözlem formu sürümü (DOM-FIN-130, K-445): ad ve ölçütler. Gözlemde kullanılmış sürüm yerinde düzeltilmez (servis 409 observation_template_used), gözlem yabancı anahtarı restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."id" IS 'Sürüm kimliği (UUID); gözlem buna bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."template_id" IS 'Şablon (lesson_observation_templates, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."version_number" IS 'Şablon içinde sürüm numarası (1, 2, …); şablonda tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."name" IS 'Formun bu sürümdeki adı (2–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."criteria" IS 'Ölçütler, sırasıyla: [{id (k1…), title, description, weight (1–10), levels: [{level 0–5, description}]}], 1–10 ölçüt. Seviye ölçeği ve ağırlık rubrik motorununkidir (DOM-BEC-020).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."created_by_user_id" IS 'Sürümü açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."updated_at" IS 'Son değişiklik anı (UTC); yalnız kullanılmamış sürüm düzeltilir.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."archived_at" IS 'Kullanılmaz (sürüm silinmez, şablon arşivlenir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observation_template_versions"."version" IS 'Satır sürümü.';
--> statement-breakpoint
COMMENT ON TABLE "lesson_observations" IS 'Ders gözlem kaydı (DOM-FIN-130, ON-206): gözlenen öğretmen, gözlemci, gün, isteğe bağlı sınıf/ders/performans dönemi, ölçüt seviyeleri ve notları, genel değerlendirme. Taslak → tamamlandı; tamamlanan kayıt değişmez (K-446). Puan saklanmaz, sürüm ölçütlerinden rubrik kuralıyla hesaplanır. Kişisel veri: yönetici, gözlemci ve tamamlanınca gözlenen öğretmen görür; okuma audit_log''a düşer (K-447).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."id" IS 'Gözlem kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."template_version_id" IS 'Kullanılan form sürümü (lesson_observation_template_versions, aynı kurum); açılışta şablonun son sürümü.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."teacher_membership_id" IS 'Gözlenen öğretmenin kurum üyeliği (memberships, aynı kurum); açılışta etkin öğretmen.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."observer_membership_id" IS 'Gözlemcinin kurum üyeliği (yönetici ya da öğretmen); gözlenenden farklı kişi.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."observed_date" IS 'Gözlem günü; bugünden sonra olamaz, dönem bağlıysa dönem içinde.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."class_id" IS 'İsteğe bağlı sınıf (records, collection ''classes'').';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."class_collection" IS 'Yabancı anahtarın koleksiyon parçası; hep ''classes'' (üretilmiş).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."subject_id" IS 'İsteğe bağlı ders (records, collection ''subjects'').';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."subject_collection" IS 'Yabancı anahtarın koleksiyon parçası; hep ''subjects'' (üretilmiş).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."performance_period_id" IS 'İsteğe bağlı performans dönemi (performance_periods, DOM-FIN-124); kapanmış döneme bağlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."ratings" IS 'Ölçüt seviyeleri, sürümün ölçüt sırasıyla: [{criterionId, level (0–5 ya da null), note}]. Hedefin altındaki seviyede (0–2) tamamlamak için not zorunlu; denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."general_note" IS 'Genel değerlendirme (1–4000); tamamlamak için zorunlu, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."status" IS 'Durum: draft (taslak, düzeltilebilir) ya da completed (tamamlandı, değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."completed_at" IS 'Tamamlanma anı (UTC); yalnız completed iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."completed_by_user_id" IS 'Gözlemi tamamlayan yönetici; completed_at ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."created_by_user_id" IS 'Gözlemi açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."archived_at" IS 'Kullanılmaz (gözlem silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_observations"."version" IS 'Satır sürümü; düzeltme ve tamamlamada If-Match ile denetlenir.';
