CREATE TABLE "staff_survey_participants" (
	"institution_id" text NOT NULL,
	"survey_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"unit_id" uuid,
	"responded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_survey_participants_pkey" PRIMARY KEY("institution_id","survey_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "staff_survey_responses" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"unit_id" uuid,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_survey_responses_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_survey_responses_answers_check" CHECK (jsonb_typeof("staff_survey_responses"."answers") = 'array' and jsonb_array_length("staff_survey_responses"."answers") between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "staff_surveys" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_survey_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"open_date" date NOT NULL,
	"close_date" date NOT NULL,
	"anonymity_threshold" integer NOT NULL,
	"audience_roles" jsonb NOT NULL,
	"audience_unit_ids" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_surveys_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_surveys_status_check" CHECK ("staff_surveys"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "staff_surveys_title_check" CHECK (char_length("staff_surveys"."title") between 3 and 150),
	CONSTRAINT "staff_surveys_dates_check" CHECK ("staff_surveys"."close_date" >= "staff_surveys"."open_date"),
	CONSTRAINT "staff_surveys_threshold_check" CHECK ("staff_surveys"."anonymity_threshold" between 3 and 10),
	CONSTRAINT "staff_surveys_revision_check" CHECK ("staff_surveys"."revision" >= 1),
	CONSTRAINT "staff_surveys_questions_check" CHECK (jsonb_typeof("staff_surveys"."questions") = 'array' and jsonb_array_length("staff_surveys"."questions") between 1 and 30),
	CONSTRAINT "staff_surveys_audience_check" CHECK (jsonb_typeof("staff_surveys"."audience_roles") = 'array' and jsonb_typeof("staff_surveys"."audience_unit_ids") = 'array'),
	CONSTRAINT "staff_surveys_published_check" CHECK ((("staff_surveys"."status" = 'published') = ("staff_surveys"."published_at" is not null))
        and (("staff_surveys"."published_at" is null) = ("staff_surveys"."published_by_user_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "staff_survey_participants" ADD CONSTRAINT "staff_survey_participants_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_participants" ADD CONSTRAINT "staff_survey_participants_survey_fkey" FOREIGN KEY ("institution_id","survey_id") REFERENCES "public"."staff_surveys"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_participants" ADD CONSTRAINT "staff_survey_participants_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_participants" ADD CONSTRAINT "staff_survey_participants_unit_fkey" FOREIGN KEY ("institution_id","unit_id") REFERENCES "public"."org_units"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_responses" ADD CONSTRAINT "staff_survey_responses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_responses" ADD CONSTRAINT "staff_survey_responses_survey_fkey" FOREIGN KEY ("institution_id","survey_id") REFERENCES "public"."staff_surveys"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_survey_responses" ADD CONSTRAINT "staff_survey_responses_unit_fkey" FOREIGN KEY ("institution_id","unit_id") REFERENCES "public"."org_units"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_surveys" ADD CONSTRAINT "staff_surveys_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_surveys" ADD CONSTRAINT "staff_surveys_source_fkey" FOREIGN KEY ("institution_id","source_survey_id") REFERENCES "public"."staff_surveys"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_survey_participants_membership_idx" ON "staff_survey_participants" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "staff_survey_participants_unit_idx" ON "staff_survey_participants" USING btree ("institution_id","unit_id");--> statement-breakpoint
CREATE INDEX "staff_survey_responses_survey_idx" ON "staff_survey_responses" USING btree ("institution_id","survey_id");--> statement-breakpoint
CREATE INDEX "staff_survey_responses_unit_idx" ON "staff_survey_responses" USING btree ("institution_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_surveys_source_key" ON "staff_surveys" USING btree ("institution_id","source_survey_id") WHERE "staff_surveys"."source_survey_id" is not null and "staff_surveys"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_surveys_source_idx" ON "staff_surveys" USING btree ("institution_id","source_survey_id");--> statement-breakpoint
CREATE INDEX "staff_surveys_close_idx" ON "staff_surveys" USING btree ("institution_id","status","close_date");--> statement-breakpoint
-- Yayımlanan anket değişmez (DOM-FIN-143, K-484): sorular, tarihler, hedef kitle ve eşik yayımda
-- donar; taslak dışındaki satır güncellenmez ve silinmez. Uygulama aynı kuralı 409 ile verir.
CREATE FUNCTION "kampus_guard_staff_survey"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'kampus: published staff survey is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Katılım işareti yalnız bir kez ve yalnız false → true değişir (K-485); kişi, anket ve birim
-- değişmez, satır silinmez. Zaman kolonları yayım anında kalır (yanıt anı saklanmaz).
CREATE FUNCTION "kampus_guard_staff_survey_participant"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.responded
    OR NOT NEW.responded
    OR NEW.survey_id IS DISTINCT FROM OLD.survey_id
    OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
    OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    RAISE EXCEPTION 'kampus: staff survey participation can only be marked once (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "staff_surveys_published_trigger" BEFORE UPDATE OR DELETE ON "staff_surveys" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_staff_survey"();--> statement-breakpoint
CREATE TRIGGER "staff_survey_participants_mark_trigger" BEFORE UPDATE OR DELETE ON "staff_survey_participants" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_staff_survey_participant"();--> statement-breakpoint
CREATE TRIGGER "staff_survey_responses_immutable_trigger" BEFORE UPDATE OR DELETE ON "staff_survey_responses" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "staff_survey_responses_truncate_trigger" BEFORE TRUNCATE ON "staff_survey_responses" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "staff_surveys" IS 'Personel memnuniyet anketi (DOM-FIN-143, ON-191, K-484): başlık, açılış ve kapanış günü (Europe/Istanbul, uçlar dahil), hedef kitle (rol ve organizasyon birimi süzgeci), anonimlik eşiği ve sorular (Likert 1–5, eNPS 0–10, açık uçlu). Taslak düzeltilir; yayımlanan satır değişmez (kampus_guard_staff_survey). Yeni sürüm yayımlanmış anketin kopyasıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."id" IS 'Anket kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."title" IS 'Anket başlığı (3–150).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."revision" IS 'Sürüm numarası: ilk anket 1, her yeni sürüm kaynağınınkinden bir fazla (K-484).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."source_survey_id" IS 'Yeni sürümün kopyalandığı yayımlanmış anket (staff_surveys, aynı kurum); ilk sürümde boş. Bir anketin tek etkin kopyası olur (staff_surveys_source_key).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."status" IS 'Durum: draft taslak, published yayımlandı, archived kaldırılmış taslak. Aşama (açılmadı, yanıta açık, kapandı) saklanmaz; yayım ve bugünden hesaplanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."open_date" IS 'Açılış günü (Europe/Istanbul, dahil); yanıt bu günden itibaren alınır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."close_date" IS 'Kapanış günü (Europe/Istanbul, dahil); ertesi gün yanıt alınmaz ve sonuç açılır (K-486). Açılıştan en çok 90 gün.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."anonymity_threshold" IS 'Sonucun gösterilmesi için gereken en az yanıt ve soru başına cevap (3–10; açılışta verilmezse kurumun anonimlik eşiği, staff_feedback_settings). Yayımda donar; sonradan düşürülemez (K-486).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."audience_roles" IS 'Hedef kitle rol süzgeci: yonetici, ogretmen, onburo dizisi; boş = bütün personel rolleri (K-484).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."audience_unit_ids" IS 'Hedef kitle birim süzgeci: org_units kimlikleri dizisi; yayım günü bu birimlerden birinde süren ataması olan personel (alt birimler dahil değil). Boş = birim süzgeci yok.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."questions" IS 'Sorular, sırasıyla: [{kind (likert 1–5 | enps 0–10 | open açık uçlu), text (5–300), required}] dizisi, 1–30 soru. Yayımdan sonra değişmez; yanıtlar bu sıraya göre saklanır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."published_at" IS 'Yayım anı (UTC); taslakta boş. Katılımcı ve yanıt satırlarının zaman kolonları da bu andır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."published_by_user_id" IS 'Anketi yayımlayan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."created_by_user_id" IS 'Taslağı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."archived_at" IS 'Taslak kaldırıldığında arşiv anı; arşivli anket listelenmez. Yayımlanmış anket kaldırılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_surveys"."version" IS 'Satır sürümü; düzeltme, yayım ve kaldırmada If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "staff_survey_participants" IS 'Anket katılımcısı ve katılım işareti (DOM-FIN-143, K-484, K-485): yayımda hedef kitleden donar. Yanıtla yalnız responded true olur; yanıtın kendisi staff_survey_responses tablosundadır ve kişiye bağlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."survey_id" IS 'Anket (staff_surveys, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."membership_id" IS 'Katılımcı personelin kurum üyeliği (memberships): yayım günü etkin yönetici, öğretmen ya da ön büro.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."unit_id" IS 'Katılımcının yayım günündeki organizasyon birimi (org_units): birim süzgeci varsa ilk eşleşen, yoksa ilk süren atamanın birimi; atama yoksa boş. Yanıt satırına kopyalanır (sonuç kırılımı).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."responded" IS 'Katılım işareti: kişi yanıt verdi mi; yalnız bir kez false → true olur (tetikleyici). Hangi yanıtın kendisine ait olduğu saklanmaz (K-485).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."created_at" IS 'Anketin yayım anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."updated_at" IS 'Anketin yayım anı (UTC); yanıtta değişmez: yanıt anı saklanmaz, katılım yanıt satırıyla zamandan eşleştirilemez (K-485).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."archived_at" IS 'Kullanılmaz (katılımcı silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_participants"."version" IS 'Kullanılmaz (1 kalır); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON TABLE "staff_survey_responses" IS 'Anonim anket yanıtı (DOM-FIN-143, K-485): üyelik ya da kullanıcı kimliği taşımaz; yalnız toplu sonuçta, kapanıştan sonra ve eşik üstünde okunur (K-486). Değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."institution_id" IS 'Kurum; birincil anahtarın ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."id" IS 'Yanıt kimliği (rastgele UUID; sıra ve zaman bilgisi taşımaz).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."survey_id" IS 'Anket (staff_surveys, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."unit_id" IS 'Yanıtlayanın yayım günündeki birimi (org_units; katılımcı satırından); birim kırılımı eşik ve tamamlayıcı gizlemeyle gösterilir (K-486).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."answers" IS 'Cevaplar, soru sırasıyla: [{value (Likert 1–5, eNPS 0–10 ya da null), text (≤ 2000 ya da null)}]. Kişiye bağlanmaz; denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."created_at" IS 'Anketin yayım anı (UTC); yanıt anı saklanmaz (K-485).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."updated_at" IS 'Anketin yayım anı (UTC); satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."archived_at" IS 'Kullanılmaz (yanıt silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_survey_responses"."version" IS 'Kullanılmaz (1 kalır); zorunlu kolon.';
