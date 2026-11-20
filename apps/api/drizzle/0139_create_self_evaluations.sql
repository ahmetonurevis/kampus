CREATE TABLE "self_evaluation_responses" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channel" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"manager_comment" text,
	"manager_comment_by_name" text,
	"manager_comment_at" timestamp with time zone,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"reopen_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "self_evaluation_responses_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "self_evaluation_responses_status_check" CHECK ("self_evaluation_responses"."status" in ('draft', 'submitted')),
	CONSTRAINT "self_evaluation_responses_channel_check" CHECK ("self_evaluation_responses"."channel" in ('paper', 'email')),
	CONSTRAINT "self_evaluation_responses_answers_check" CHECK (jsonb_typeof("self_evaluation_responses"."answers") = 'array' and jsonb_array_length("self_evaluation_responses"."answers") between 1 and 20),
	CONSTRAINT "self_evaluation_responses_submitted_check" CHECK ((("self_evaluation_responses"."status" = 'submitted') = ("self_evaluation_responses"."submitted_at" is not null))
        and (("self_evaluation_responses"."submitted_at" is null) = ("self_evaluation_responses"."submitted_by_user_id" is null))),
	CONSTRAINT "self_evaluation_responses_comment_check" CHECK (("self_evaluation_responses"."manager_comment" is null or char_length("self_evaluation_responses"."manager_comment") between 1 and 2000)
        and (("self_evaluation_responses"."manager_comment" is null) = ("self_evaluation_responses"."manager_comment_by_name" is null))
        and (("self_evaluation_responses"."manager_comment" is null) = ("self_evaluation_responses"."manager_comment_at" is null))),
	CONSTRAINT "self_evaluation_responses_reopen_check" CHECK ("self_evaluation_responses"."reopen_count" >= 0
        and (("self_evaluation_responses"."reopen_count" = 0) = ("self_evaluation_responses"."reopened_at" is null))
        and (("self_evaluation_responses"."reopened_at" is null) = ("self_evaluation_responses"."reopened_by_user_id" is null))
        and (("self_evaluation_responses"."reopened_at" is null) = ("self_evaluation_responses"."reopen_reason" is null))
        and ("self_evaluation_responses"."reopen_reason" is null or char_length("self_evaluation_responses"."reopen_reason") between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "self_evaluation_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "self_evaluation_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "self_evaluation_templates_questions_check" CHECK (jsonb_typeof("self_evaluation_templates"."questions") = 'array' and jsonb_array_length("self_evaluation_templates"."questions") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "self_evaluation_responses" ADD CONSTRAINT "self_evaluation_responses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_responses" ADD CONSTRAINT "self_evaluation_responses_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_responses" ADD CONSTRAINT "self_evaluation_responses_template_fkey" FOREIGN KEY ("institution_id","template_id") REFERENCES "public"."self_evaluation_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_responses" ADD CONSTRAINT "self_evaluation_responses_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_responses" ADD CONSTRAINT "self_evaluation_responses_review_fkey" FOREIGN KEY ("institution_id","period_id","membership_id") REFERENCES "public"."performance_reviews"("institution_id","period_id","membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_templates" ADD CONSTRAINT "self_evaluation_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_evaluation_templates" ADD CONSTRAINT "self_evaluation_templates_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "self_evaluation_responses_member_key" ON "self_evaluation_responses" USING btree ("institution_id","period_id","membership_id");--> statement-breakpoint
CREATE INDEX "self_evaluation_responses_template_idx" ON "self_evaluation_responses" USING btree ("institution_id","template_id");--> statement-breakpoint
CREATE INDEX "self_evaluation_responses_membership_idx" ON "self_evaluation_responses" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "self_evaluation_templates_period_key" ON "self_evaluation_templates" USING btree ("institution_id","period_id");--> statement-breakpoint
COMMENT ON TABLE "self_evaluation_templates" IS 'Öz değerlendirme şablonu (DOM-FIN-131, ON-210): performans dönemi başına tek şablon; puanlı (1–5) ve açık uçlu sorular. Dönemde yanıt açılınca ya da dönem kapanınca sorular değişmez (K-448).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."id" IS 'Şablon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."period_id" IS 'Performans dönemi (performance_periods, aynı kurum); dönem başına tek şablon.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."questions" IS 'Sorular, sırasıyla: [{kind (scale puanlı 1–5 | open açık uçlu), text (5–300), required}] dizisi, 1–20 soru.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."created_by_user_id" IS 'Şablonu açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."archived_at" IS 'Kullanılmaz (şablon silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_templates"."version" IS 'Satır sürümü; soru düzeltmesinde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "self_evaluation_responses" IS 'Personel × dönem öz değerlendirme yanıtı (DOM-FIN-131, ON-210): cevaplar, durum (taslak, gönderildi), giriş kanalı, yönetici görüşü ve geri açma izi. Yanıt dönemdeki performans kaydına bağlıdır; gönderilen yanıt düzenlenmez, yönetici gerekçeyle geri açar (K-449). Kişisel veri: yalnız yönetici okur, ayrıntı okuması audit_log''a düşer (K-450).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."id" IS 'Yanıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."period_id" IS 'Performans dönemi (performance_periods, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."template_id" IS 'Yanıtın verildiği şablon (self_evaluation_templates, aynı kurum ve dönem).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."membership_id" IS 'Yanıtı veren personelin kurum üyeliği (memberships); (period_id, membership_id) dönemdeki performans kaydına (performance_reviews) bağlıdır. Personel × dönem tek yanıt.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."answers" IS 'Cevaplar, soru sırasıyla: [{score (1–5 ya da null), text (≤ 2000 ya da null)}]; puanlı soruda yalnız puan, açık uçluda yalnız metin. Denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."status" IS 'Durum: draft taslak, submitted gönderildi (K-449).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."channel" IS 'Yanıtın geldiği kanal (yönetici personel adına girer): paper kâğıt form, email e-posta (K-449).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."submitted_at" IS 'Son gönderim anı (UTC); yalnız gönderildi durumunda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."submitted_by_user_id" IS 'Yanıtı gönderen (personel adına kaydeden) yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."manager_comment" IS 'Yöneticinin öz değerlendirmeye görüşü (1–2000); yalnız gönderilmiş yanıta yazılır, geri açmada korunur (K-450). Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."manager_comment_by_name" IS 'Görüşü son yazan yöneticinin o anki adı.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."manager_comment_at" IS 'Görüşün son yazıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."reopen_count" IS 'Gönderilmiş yanıtın taslağa kaç kez geri açıldığı.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."reopened_at" IS 'Son geri açma anı (UTC); geri açma yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."reopened_by_user_id" IS 'Son geri açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."reopen_reason" IS 'Son geri açmanın gerekçesi (5–500, zorunlu; K-449). Denetim kaydına yalnız alan adı yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."created_by_user_id" IS 'Yanıtı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."archived_at" IS 'Kullanılmaz (yanıt silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "self_evaluation_responses"."version" IS 'Satır sürümü; düzeltme, gönderim ve geri açmada If-Match ile denetlenir.';
