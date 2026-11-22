CREATE TABLE "teacher_feedback_participations" (
	"institution_id" text NOT NULL,
	"survey_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_feedback_participations_pkey" PRIMARY KEY("institution_id","survey_id","membership_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "teacher_feedback_responses" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_feedback_responses_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_feedback_responses_answers_check" CHECK (jsonb_typeof("teacher_feedback_responses"."answers") = 'array' and jsonb_array_length("teacher_feedback_responses"."answers") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "teacher_feedback_surveys" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"term" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"open_date" date NOT NULL,
	"close_date" date NOT NULL,
	"anonymity_threshold" integer NOT NULL,
	"respondent_roles" jsonb NOT NULL,
	"class_ids" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_feedback_surveys_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_feedback_surveys_status_check" CHECK ("teacher_feedback_surveys"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "teacher_feedback_surveys_title_check" CHECK (char_length("teacher_feedback_surveys"."title") between 3 and 150),
	CONSTRAINT "teacher_feedback_surveys_term_check" CHECK (char_length("teacher_feedback_surveys"."term") between 2 and 60),
	CONSTRAINT "teacher_feedback_surveys_dates_check" CHECK ("teacher_feedback_surveys"."close_date" >= "teacher_feedback_surveys"."open_date"),
	CONSTRAINT "teacher_feedback_surveys_threshold_check" CHECK ("teacher_feedback_surveys"."anonymity_threshold" between 5 and 20),
	CONSTRAINT "teacher_feedback_surveys_questions_check" CHECK (jsonb_typeof("teacher_feedback_surveys"."questions") = 'array' and jsonb_array_length("teacher_feedback_surveys"."questions") between 1 and 20),
	CONSTRAINT "teacher_feedback_surveys_audience_check" CHECK (jsonb_typeof("teacher_feedback_surveys"."respondent_roles") = 'array' and jsonb_array_length("teacher_feedback_surveys"."respondent_roles") between 1 and 2 and jsonb_typeof("teacher_feedback_surveys"."class_ids") = 'array'),
	CONSTRAINT "teacher_feedback_surveys_published_check" CHECK ((("teacher_feedback_surveys"."status" = 'published') = ("teacher_feedback_surveys"."published_at" is not null))
        and (("teacher_feedback_surveys"."published_at" is null) = ("teacher_feedback_surveys"."published_by_user_id" is null))),
	CONSTRAINT "teacher_feedback_surveys_closed_check" CHECK ((("teacher_feedback_surveys"."closed_at" is null) = ("teacher_feedback_surveys"."closed_by_user_id" is null))
        and ("teacher_feedback_surveys"."closed_at" is null or "teacher_feedback_surveys"."status" = 'published'))
);
--> statement-breakpoint
ALTER TABLE "teacher_feedback_participations" ADD CONSTRAINT "teacher_feedback_participations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_feedback_participations" ADD CONSTRAINT "teacher_feedback_participations_survey_fkey" FOREIGN KEY ("institution_id","survey_id") REFERENCES "public"."teacher_feedback_surveys"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_feedback_participations" ADD CONSTRAINT "teacher_feedback_participations_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_feedback_responses" ADD CONSTRAINT "teacher_feedback_responses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_feedback_responses" ADD CONSTRAINT "teacher_feedback_responses_survey_fkey" FOREIGN KEY ("institution_id","survey_id") REFERENCES "public"."teacher_feedback_surveys"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_feedback_surveys" ADD CONSTRAINT "teacher_feedback_surveys_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teacher_feedback_participations_membership_idx" ON "teacher_feedback_participations" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "teacher_feedback_responses_survey_idx" ON "teacher_feedback_responses" USING btree ("institution_id","survey_id","teacher_id");--> statement-breakpoint
CREATE INDEX "teacher_feedback_responses_teacher_idx" ON "teacher_feedback_responses" USING btree ("institution_id","teacher_id");--> statement-breakpoint
CREATE INDEX "teacher_feedback_surveys_close_idx" ON "teacher_feedback_surveys" USING btree ("institution_id","status","close_date");--> statement-breakpoint
-- Yayımlanan anket değişmez (DOM-FIN-159, K-532): sorular, tarihler, hedef kitle ve eşik yayımda
-- donar. Tek istisna erken kapatmadır: closed_at ve closed_by_user_id bir kez boştan dolar,
-- updated_at ve version ilerler. Uygulama aynı kuralı 409 ile verir.
CREATE FUNCTION "kampus_guard_teacher_feedback_survey"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    OR OLD.closed_at IS NOT NULL
    OR NEW.closed_at IS NULL
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.term IS DISTINCT FROM OLD.term
    OR NEW.open_date IS DISTINCT FROM OLD.open_date
    OR NEW.close_date IS DISTINCT FROM OLD.close_date
    OR NEW.anonymity_threshold IS DISTINCT FROM OLD.anonymity_threshold
    OR NEW.respondent_roles IS DISTINCT FROM OLD.respondent_roles
    OR NEW.class_ids IS DISTINCT FROM OLD.class_ids
    OR NEW.questions IS DISTINCT FROM OLD.questions
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'kampus: published teacher feedback survey is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "teacher_feedback_surveys_published_trigger" BEFORE UPDATE OR DELETE ON "teacher_feedback_surveys" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_teacher_feedback_survey"();--> statement-breakpoint
CREATE TRIGGER "teacher_feedback_participations_immutable_trigger" BEFORE UPDATE OR DELETE ON "teacher_feedback_participations" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "teacher_feedback_participations_truncate_trigger" BEFORE TRUNCATE ON "teacher_feedback_participations" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "teacher_feedback_responses_immutable_trigger" BEFORE UPDATE OR DELETE ON "teacher_feedback_responses" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "teacher_feedback_responses_truncate_trigger" BEFORE TRUNCATE ON "teacher_feedback_responses" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "teacher_feedback_surveys" IS 'Öğretmene yönelik öğrenci ve veli geri bildirim anketi (DOM-FIN-159, ON-213, IST-069, K-532, K-533): başlık, dönem, açılış ve kapanış günü (Europe/Istanbul, uçlar dahil), hedef kitle (öğrenci, veli ya da ikisi; sınıf süzgeci), anonimlik eşiği ve sorular (ölçek 1–5, açık uçlu). Taslak düzeltilir; yayımlanan satır değişmez, yalnız erken kapatılır (kampus_guard_teacher_feedback_survey).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."id" IS 'Anket kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."title" IS 'Anket başlığı (3–150).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."term" IS 'Dönem adı (2–60, ör. 2026–2027 1. dönem); dönemler arası eğilimde etiket olur.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."status" IS 'Durum: draft taslak, published yayımlandı, archived kaldırılmış taslak. Aşama (açılmadı, yanıta açık, kapandı) saklanmaz; yayım, closed_at ve bugünden hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."open_date" IS 'Açılış günü (Europe/Istanbul, dahil).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."close_date" IS 'Kapanış günü (Europe/Istanbul, dahil); ertesi gün yanıt alınmaz ve sonuç açılır. Açılıştan en çok 90 gün.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."anonymity_threshold" IS 'Öğretmen başına sonucun ve soru başına cevabın gösterilmesi için gereken en az yanıt (5–20, varsayılan 5; kurum artırabilir, azaltamaz, K-532). Yayımda donar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."respondent_roles" IS 'Yanıtlayan roller: ogrenci, veli ya da ikisi (K-533).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."class_ids" IS 'Sınıf/grup süzgeci: records classes kimlikleri dizisi (öğrencinin güncel sınıfı); boş = bütün sınıflar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."questions" IS 'Sorular, sırasıyla: [{kind (likert 1–5 | open açık uçlu), text (5–300), required}] dizisi, 1–20 soru, en az bir ölçek sorusu. Yayımdan sonra değişmez; yanıtlar bu sıraya göre saklanır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."published_at" IS 'Yayım anı (UTC); taslakta boş. Katılım ve yanıt satırlarının zaman kolonları da bu andır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."published_by_user_id" IS 'Anketi yayımlayan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."closed_at" IS 'Yöneticinin erken kapatma anı (UTC); boşsa anket kapanış günü geçince kapanır. Bir kez yazılır, geri alınmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."closed_by_user_id" IS 'Anketi erken kapatan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."created_by_user_id" IS 'Taslağı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."archived_at" IS 'Taslak kaldırıldığında arşiv anı; arşivli anket listelenmez. Yayımlanmış anket kaldırılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_surveys"."version" IS 'Satır sürümü; düzeltme, yayım, kaldırma ve kapatmada If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "teacher_feedback_participations" IS 'Katılım işareti (DOM-FIN-159, K-533): yanıtlayan üyelik × anket × öğretmen; her öğretmen için bir kez yanıtı sağlar. Yalnız eklenir, değişmez ve silinmez. Yanıtın kendisi teacher_feedback_responses tablosundadır ve kişiye bağlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."survey_id" IS 'Anket (teacher_feedback_surveys, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."membership_id" IS 'Yanıtlayan öğrenci ya da velinin kurum üyeliği (memberships).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."teacher_id" IS 'Değerlendirilen öğretmen kaydı (records teachers kimliği). Hangi yanıtın bu kişiye ait olduğu saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."created_at" IS 'Anketin yayım anı (UTC); yanıt anı saklanmaz, katılım yanıt satırıyla zamandan eşleştirilemez.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."updated_at" IS 'Anketin yayım anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."archived_at" IS 'Kullanılmaz (katılım silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_participations"."version" IS 'Kullanılmaz (1 kalır); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON TABLE "teacher_feedback_responses" IS 'Anonim öğretmen geri bildirimi (DOM-FIN-159, K-532, K-533): üyelik, kullanıcı ve yanıtlayan rolü taşımaz; yalnız öğretmen başına toplu sonuçta, kapanıştan sonra ve eşik üstünde okunur. Değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."id" IS 'Yanıt kimliği (rastgele UUID; sıra ve zaman bilgisi taşımaz).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."survey_id" IS 'Anket (teacher_feedback_surveys, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."teacher_id" IS 'Değerlendirilen öğretmen kaydı (records teachers kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."class_id" IS 'Kırılım sınıfı: öğretmenin yanıtlayanla eşleştiği sınıf (records classes kimliği); eşik altındaki sınıflar sonuçta birleşir (K-532).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."answers" IS 'Cevaplar, soru sırasıyla: [{value (1–5 ya da null), text (≤ 1000 ya da null)}]. Kişiye bağlanmaz; denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."created_at" IS 'Anketin yayım anı (UTC); yanıt anı saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."updated_at" IS 'Anketin yayım anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."archived_at" IS 'Kullanılmaz (yanıt silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_feedback_responses"."version" IS 'Kullanılmaz (1 kalır); zorunlu kolon.';
