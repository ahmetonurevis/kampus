CREATE TABLE "candidate_interview_evaluations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"candidate_interview_id" uuid NOT NULL,
	"evaluator_membership_id" text NOT NULL,
	"ratings" jsonb,
	"general_note" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "candidate_interview_evaluations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "candidate_interview_evaluations_submitted_check" CHECK ((("candidate_interview_evaluations"."submitted_at" is null) = ("candidate_interview_evaluations"."ratings" is null))
        and ("candidate_interview_evaluations"."submitted_at" is not null or "candidate_interview_evaluations"."general_note" is null)),
	CONSTRAINT "candidate_interview_evaluations_ratings_check" CHECK ("candidate_interview_evaluations"."ratings" is null or (jsonb_typeof("candidate_interview_evaluations"."ratings") = 'array'
        and jsonb_array_length("candidate_interview_evaluations"."ratings") between 1 and 10)),
	CONSTRAINT "candidate_interview_evaluations_note_check" CHECK ("candidate_interview_evaluations"."general_note" is null
        or char_length("candidate_interview_evaluations"."general_note") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "candidate_interviews" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"job_application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text,
	"meeting_url" text,
	"interview_template_version_id" uuid,
	"observation_template_version_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "candidate_interviews_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "candidate_interviews_type_check" CHECK ("candidate_interviews"."type" in ('pre_screen', 'in_person', 'online', 'sample_lesson')),
	CONSTRAINT "candidate_interviews_status_check" CHECK ("candidate_interviews"."status" in ('planned', 'completed', 'cancelled')),
	CONSTRAINT "candidate_interviews_form_check" CHECK (("candidate_interviews"."type" = 'sample_lesson') = ("candidate_interviews"."observation_template_version_id" is not null)
        and ("candidate_interviews"."interview_template_version_id" is null) = ("candidate_interviews"."observation_template_version_id" is not null)),
	CONSTRAINT "candidate_interviews_location_check" CHECK ("candidate_interviews"."location" is null or char_length("candidate_interviews"."location") between 1 and 200),
	CONSTRAINT "candidate_interviews_url_check" CHECK ("candidate_interviews"."meeting_url" is null or char_length("candidate_interviews"."meeting_url") between 9 and 500),
	CONSTRAINT "candidate_interviews_completed_check" CHECK ((("candidate_interviews"."status" = 'completed') = ("candidate_interviews"."completed_at" is not null))
        and (("candidate_interviews"."completed_at" is null) = ("candidate_interviews"."completed_by_user_id" is null))),
	CONSTRAINT "candidate_interviews_cancelled_check" CHECK ((("candidate_interviews"."status" = 'cancelled') = ("candidate_interviews"."cancelled_at" is not null))
        and (("candidate_interviews"."cancelled_at" is null) = ("candidate_interviews"."cancelled_by_user_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "interview_template_versions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"scale_max" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "interview_template_versions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "interview_template_versions_name_check" CHECK (char_length("interview_template_versions"."name") between 2 and 120),
	CONSTRAINT "interview_template_versions_scale_check" CHECK ("interview_template_versions"."scale_max" between 3 and 10),
	CONSTRAINT "interview_template_versions_criteria_check" CHECK (jsonb_typeof("interview_template_versions"."criteria") = 'array'
        and jsonb_array_length("interview_template_versions"."criteria") between 1 and 10),
	CONSTRAINT "interview_template_versions_number_check" CHECK ("interview_template_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "interview_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"latest_version_number" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "interview_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "interview_templates_latest_check" CHECK ("interview_templates"."latest_version_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "candidate_interview_evaluations" ADD CONSTRAINT "candidate_interview_evaluations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_evaluations" ADD CONSTRAINT "candidate_interview_evaluations_interview_fkey" FOREIGN KEY ("institution_id","candidate_interview_id") REFERENCES "public"."candidate_interviews"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_evaluations" ADD CONSTRAINT "candidate_interview_evaluations_evaluator_fkey" FOREIGN KEY ("institution_id","evaluator_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_application_fkey" FOREIGN KEY ("institution_id","job_application_id") REFERENCES "public"."job_applications"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_interview_version_fkey" FOREIGN KEY ("institution_id","interview_template_version_id") REFERENCES "public"."interview_template_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_observation_version_fkey" FOREIGN KEY ("institution_id","observation_template_version_id") REFERENCES "public"."lesson_observation_template_versions"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_template_versions" ADD CONSTRAINT "interview_template_versions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_template_versions" ADD CONSTRAINT "interview_template_versions_template_fkey" FOREIGN KEY ("institution_id","template_id") REFERENCES "public"."interview_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_interview_evaluations_evaluator_key" ON "candidate_interview_evaluations" USING btree ("institution_id","candidate_interview_id","evaluator_membership_id");--> statement-breakpoint
CREATE INDEX "candidate_interview_evaluations_member_idx" ON "candidate_interview_evaluations" USING btree ("institution_id","evaluator_membership_id");--> statement-breakpoint
CREATE INDEX "candidate_interviews_application_idx" ON "candidate_interviews" USING btree ("institution_id","job_application_id");--> statement-breakpoint
CREATE INDEX "candidate_interviews_interview_version_idx" ON "candidate_interviews" USING btree ("institution_id","interview_template_version_id");--> statement-breakpoint
CREATE INDEX "candidate_interviews_observation_version_idx" ON "candidate_interviews" USING btree ("institution_id","observation_template_version_id");--> statement-breakpoint
CREATE INDEX "candidate_interviews_scheduled_idx" ON "candidate_interviews" USING btree ("institution_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_template_versions_number_key" ON "interview_template_versions" USING btree ("institution_id","template_id","version_number");--> statement-breakpoint
COMMENT ON TABLE "interview_templates" IS 'Mülakat formu şablonu (DOM-FIN-138, ON-178): kimlik ve arşiv. Ad, ölçek ve ölçütler sürümdedir (interview_template_versions); mülakatta kullanılmış sürüm değişmez, yeni sürüm açılır (K-470). Yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."id" IS 'Şablon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."latest_version_number" IS 'Son sürüm numarası; yeni mülakat bu sürümü kullanır.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."created_by_user_id" IS 'Şablonu açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."archived_at" IS 'Arşiv anı; arşivli form yeni mülakatta seçilmez ve değişmez, eski mülakatlar sürümüyle okunur.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_templates"."version" IS 'Satır sürümü; düzeltme, yeni sürüm ve arşivde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "interview_template_versions" IS 'Mülakat formu sürümü (DOM-FIN-138, K-470): ad, ölçek ve ölçütler. Mülakatta kullanılmış sürüm yerinde düzeltilmez (servis 409 interview_template_used), mülakat yabancı anahtarı restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."id" IS 'Sürüm kimliği (UUID); mülakat buna bağlanır.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."template_id" IS 'Şablon (interview_templates, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."version_number" IS 'Şablon içinde sürüm numarası (1, 2, …); şablonda tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."name" IS 'Formun bu sürümdeki adı (2–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."scale_max" IS 'Puan ölçeğinin üst ucu (3–10); değerlendirici her ölçüte 1 ile bu değer arasında puan verir.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."criteria" IS 'Ölçütler, sırasıyla: [{id (k1…), title, description, weight (1–10)}], 1–10 ölçüt. Puan ağırlıklı toplamdır, saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."created_by_user_id" IS 'Sürümü açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."updated_at" IS 'Son değişiklik anı (UTC); yalnız kullanılmamış sürüm düzeltilir.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."archived_at" IS 'Kullanılmaz (sürüm silinmez, şablon arşivlenir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "interview_template_versions"."version" IS 'Satır sürümü; zorunlu kolon (şablonun If-Match sürümü interview_templates satırındadır).';
--> statement-breakpoint
COMMENT ON TABLE "candidate_interviews" IS 'Aday mülakatı (DOM-FIN-138, ON-178, K-469): iş başvurusuna bağlı tür, an, yer ya da bağlantı ve form sürümü. Yalnız "mülakat" aşamasındaki başvuruya planlanır; planlandı → yapıldı ya da iptal. "Teklif" ve "işe alındı" geçişi en az bir yapılmış mülakat ister. Satır silinmez; başvuru anonimleştirilince yer ve bağlantı silinir, planlı mülakat iptal olur (K-471).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."id" IS 'Mülakat kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."job_application_id" IS 'Başvuru (job_applications, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."type" IS 'Tür: pre_screen ön görüşme, in_person yüz yüze, online çevrim içi, sample_lesson örnek ders.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."scheduled_at" IS 'Mülakat anı (UTC); "yapıldı" bu andan önce işaretlenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."location" IS 'Yer (≤ 200); yüz yüze ve örnek derste planlamada zorunlu, anonimleştirmede silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."meeting_url" IS 'Görüşme bağlantısı (https, ≤ 500); çevrim içide planlamada zorunlu, anonimleştirmede silinir.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."interview_template_version_id" IS 'Mülakat formu sürümü (interview_template_versions); örnek ders dışındaki türlerde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."observation_template_version_id" IS 'Örnek derste ders gözlem formu sürümü (lesson_observation_template_versions, DOM-FIN-130); aday üye olmadığından gözlem kaydı açılmaz, puan gözlem kuralıyla hesaplanır (K-471).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."status" IS 'Durum: planned planlandı, completed yapıldı, cancelled iptal.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."completed_at" IS '"Yapıldı" işaretlendiği an; yalnız yapılmış mülakatta dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."completed_by_user_id" IS '"Yapıldı" işaretleyen yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."cancelled_at" IS 'İptal anı; yalnız iptal edilmiş mülakatta dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."cancelled_by_user_id" IS 'İptal eden yönetici ya da anonimleştiren yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."created_by_user_id" IS 'Mülakatı planlayan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."archived_at" IS 'Kullanılmaz (mülakat silinmez, iptal edilir); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interviews"."version" IS 'Satır sürümü; düzeltme, yapıldı ve iptalde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "candidate_interview_evaluations" IS 'Mülakat değerlendiricisi ve formu (DOM-FIN-138, K-470): planlamada değerlendirici başına açılır; değerlendirici yapılmış mülakatta puan ve notlarını bir kez gönderir, sonra satır değişmez (servis 409 candidate_evaluation_submitted). Puan saklanmaz, form sürümünden hesaplanır. Başvuru anonimleştirilince notlar silinir, puanlar kalır (K-471).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."id" IS 'Değerlendirme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."candidate_interview_id" IS 'Mülakat (candidate_interviews, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."evaluator_membership_id" IS 'Değerlendiricinin kurum üyeliği (yönetici ya da öğretmen); mülakatta tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."ratings" IS 'Gönderilen puanlar, formun ölçüt sırasıyla: [{criterionId, score, note}]; mülakat formunda 1–ölçek, örnek derste 0–5. Gönderilmeden boş.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."general_note" IS 'Genel değerlendirme (≤ 4000); gönderimde zorunlu, anonimleştirmede silinir. Loglanmaz, denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."submitted_at" IS 'Gönderim anı; doluysa değerlendirme değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."archived_at" IS 'Kullanılmaz (değerlendirme silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "candidate_interview_evaluations"."version" IS 'Satır sürümü; gönderimde ilerler.';
