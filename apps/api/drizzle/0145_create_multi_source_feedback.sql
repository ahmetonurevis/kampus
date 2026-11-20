CREATE TABLE "staff_feedback_assignments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"subject_membership_id" text NOT NULL,
	"reviewer_membership_id" text NOT NULL,
	"relation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"template_id" uuid,
	"answers" jsonb,
	"channel" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"withdraw_count" integer DEFAULT 0 NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" text,
	"withdraw_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_feedback_assignments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_feedback_assignments_self_check" CHECK ("staff_feedback_assignments"."subject_membership_id" <> "staff_feedback_assignments"."reviewer_membership_id"),
	CONSTRAINT "staff_feedback_assignments_relation_check" CHECK ("staff_feedback_assignments"."relation" in ('manager', 'peer')),
	CONSTRAINT "staff_feedback_assignments_status_check" CHECK ("staff_feedback_assignments"."status" in ('pending', 'submitted')),
	CONSTRAINT "staff_feedback_assignments_channel_check" CHECK ("staff_feedback_assignments"."channel" is null or "staff_feedback_assignments"."channel" in ('paper', 'email')),
	CONSTRAINT "staff_feedback_assignments_response_check" CHECK ((("staff_feedback_assignments"."status" = 'submitted') = ("staff_feedback_assignments"."answers" is not null))
        and (("staff_feedback_assignments"."answers" is null) = ("staff_feedback_assignments"."channel" is null))
        and (("staff_feedback_assignments"."answers" is null) = ("staff_feedback_assignments"."submitted_at" is null))
        and (("staff_feedback_assignments"."submitted_at" is null) = ("staff_feedback_assignments"."submitted_by_user_id" is null))
        and ("staff_feedback_assignments"."answers" is null or "staff_feedback_assignments"."template_id" is not null)
        and ("staff_feedback_assignments"."answers" is null or (jsonb_typeof("staff_feedback_assignments"."answers") = 'array' and jsonb_array_length("staff_feedback_assignments"."answers") between 1 and 20))),
	CONSTRAINT "staff_feedback_assignments_withdraw_check" CHECK ("staff_feedback_assignments"."withdraw_count" >= 0
        and (("staff_feedback_assignments"."withdraw_count" = 0) = ("staff_feedback_assignments"."withdrawn_at" is null))
        and (("staff_feedback_assignments"."withdrawn_at" is null) = ("staff_feedback_assignments"."withdrawn_by_user_id" is null))
        and (("staff_feedback_assignments"."withdrawn_at" is null) = ("staff_feedback_assignments"."withdraw_reason" is null))
        and ("staff_feedback_assignments"."withdraw_reason" is null or char_length("staff_feedback_assignments"."withdraw_reason") between 5 and 500))
);
--> statement-breakpoint
CREATE TABLE "staff_feedback_settings" (
	"institution_id" text PRIMARY KEY NOT NULL,
	"peer_anonymity_threshold" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_feedback_settings_threshold_check" CHECK ("staff_feedback_settings"."peer_anonymity_threshold" between 3 and 10)
);
--> statement-breakpoint
CREATE TABLE "staff_feedback_templates" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_feedback_templates_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_feedback_templates_questions_check" CHECK (jsonb_typeof("staff_feedback_templates"."questions") = 'array' and jsonb_array_length("staff_feedback_templates"."questions") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_subject_fkey" FOREIGN KEY ("institution_id","subject_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_review_fkey" FOREIGN KEY ("institution_id","period_id","subject_membership_id") REFERENCES "public"."performance_reviews"("institution_id","period_id","membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_reviewer_fkey" FOREIGN KEY ("institution_id","reviewer_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_assignments" ADD CONSTRAINT "staff_feedback_assignments_template_fkey" FOREIGN KEY ("institution_id","template_id") REFERENCES "public"."staff_feedback_templates"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_settings" ADD CONSTRAINT "staff_feedback_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_templates" ADD CONSTRAINT "staff_feedback_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_feedback_templates" ADD CONSTRAINT "staff_feedback_templates_period_fkey" FOREIGN KEY ("institution_id","period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_feedback_assignments_pair_key" ON "staff_feedback_assignments" USING btree ("institution_id","period_id","subject_membership_id","reviewer_membership_id") WHERE "staff_feedback_assignments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_feedback_assignments_period_idx" ON "staff_feedback_assignments" USING btree ("institution_id","period_id");--> statement-breakpoint
CREATE INDEX "staff_feedback_assignments_subject_idx" ON "staff_feedback_assignments" USING btree ("institution_id","subject_membership_id");--> statement-breakpoint
CREATE INDEX "staff_feedback_assignments_reviewer_idx" ON "staff_feedback_assignments" USING btree ("institution_id","reviewer_membership_id");--> statement-breakpoint
CREATE INDEX "staff_feedback_assignments_template_idx" ON "staff_feedback_assignments" USING btree ("institution_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_feedback_templates_period_key" ON "staff_feedback_templates" USING btree ("institution_id","period_id");--> statement-breakpoint
COMMENT ON TABLE "staff_feedback_settings" IS 'Çok kaynaklı geri bildirim kurum ayarı (DOM-FIN-134, ON-212): meslektaş anonimlik eşiği. Satır yoksa varsayılan 3 geçerlidir (K-459).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."institution_id" IS 'Kurum; birincil anahtar (kurum başına tek satır).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."peer_anonymity_threshold" IS 'Meslektaş sonucunun toplu gösterilmesi için gereken en az yanıt (3–10, varsayılan 3). Eşik altında meslektaş sonucu gizlidir; alt sınır 3 iki yanıtlı ortalamadan tek cevabın çıkarılmasını önler (K-459).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."archived_at" IS 'Kullanılmaz (ayar silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_settings"."version" IS 'Satır sürümü; eşik değişikliğinde If-Match ile denetlenir (satır yokken 1).';
--> statement-breakpoint
COMMENT ON TABLE "staff_feedback_templates" IS 'Çok kaynaklı geri bildirim şablonu (DOM-FIN-134, ON-212): performans dönemi başına tek şablon; puanlı (1–5) ve açık uçlu sorular. Dönemde yanıt girilince ya da dönem kapanınca sorular değişmez (K-457).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."id" IS 'Şablon kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."period_id" IS 'Performans dönemi (performance_periods, aynı kurum); dönem başına tek şablon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."questions" IS 'Sorular, sırasıyla: [{kind (scale puanlı 1–5 | open açık uçlu), text (5–300), required}] dizisi, 1–20 soru.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."created_by_user_id" IS 'Şablonu açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."archived_at" IS 'Kullanılmaz (şablon silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_templates"."version" IS 'Satır sürümü; soru düzeltmesinde If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "staff_feedback_assignments" IS 'Değerlendiren ataması ve yanıtı (DOM-FIN-134, ON-212): dönemde performans kaydı olan personel (değerlendirilen) × kurumun etkin personeli (değerlendiren), ilişki türü yönetici ya da meslektaş; kişi kendini değerlendirmez. Yanıtı yönetici değerlendiren adına girer (kâğıt form, e-posta); yanıt bekliyor → yanıtlandı, gerekçeyle geri alınır (K-458). Meslektaş yanıtı tek tek okunmaz; yalnız toplu, değerlendirme aşamasından sonra ve eşik üstünde gösterilir (K-459). Yanıtı girilmemiş atama kaldırılınca arşivlenir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."id" IS 'Atama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."period_id" IS 'Performans dönemi (performance_periods, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."subject_membership_id" IS 'Değerlendirilen personelin kurum üyeliği (memberships); (period_id, subject_membership_id) dönemdeki performans kaydına (performance_reviews) bağlıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."reviewer_membership_id" IS 'Değerlendirenin kurum üyeliği (memberships): etkin yönetici, öğretmen ya da ön büro; değerlendirilenden başka kişi. Dönemde değerlendirilen × değerlendiren tek etkin atama.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."relation" IS 'İlişki türü: manager yönetici (yanıtı adıyla gösterilir), peer meslektaş (anonim; yalnız toplu ve eşik üstünde) (K-459).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."status" IS 'Durum: pending yanıt bekleniyor, submitted yanıtlandı (K-458).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."template_id" IS 'Yanıtın girildiği şablon (staff_feedback_templates, aynı kurum ve dönem); ilk yanıtta yazılır, geri almada korunur (şablon kilidi).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."answers" IS 'Cevaplar, soru sırasıyla: [{score (1–5 ya da null), text (≤ 2000 ya da null)}]; yalnız yanıtlandı durumunda dolu, geri alınınca silinir. Meslektaş cevabı hiçbir uçta tek tek dönmez; denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."channel" IS 'Yanıtın geldiği kanal (yönetici değerlendiren adına girer): paper kâğıt form, email e-posta (K-458).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."submitted_at" IS 'Yanıtın girildiği an (UTC); yalnız yanıtlandı durumunda dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."submitted_by_user_id" IS 'Yanıtı değerlendiren adına giren yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."withdraw_count" IS 'Girilmiş yanıtın kaç kez geri alındığı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."withdrawn_at" IS 'Son geri alma anı (UTC); geri alma yoksa boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."withdrawn_by_user_id" IS 'Son geri alan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."withdraw_reason" IS 'Son geri almanın gerekçesi (5–500, zorunlu; K-458). Denetim kaydına yalnız alan adı yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."created_by_user_id" IS 'Atamayı yapan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."archived_at" IS 'Yanıtı girilmemiş atama kaldırıldığında arşiv anı; arşivli atama sayılmaz ve listelenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_feedback_assignments"."version" IS 'Satır sürümü; kaldırma, yanıt girişi ve geri almada If-Match ile denetlenir.';
