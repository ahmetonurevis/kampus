CREATE TABLE "consents" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"purpose" text NOT NULL,
	"decision" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"grantor_relation" text NOT NULL,
	"text_id" uuid NOT NULL,
	"text_version" integer NOT NULL,
	"channel" text NOT NULL,
	"given_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" text,
	"withdrawal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "consents_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "consents_subject_kind_check" CHECK ("consents"."subject_kind" in ('student', 'user')),
	CONSTRAINT "consents_purpose_check" CHECK ("consents"."purpose" in ('photo_video_sharing', 'photo_video_website', 'photo_video_social_media', 'photo_video_print', 'promotional_messages', 'speaking_recording')),
	CONSTRAINT "consents_decision_check" CHECK ("consents"."decision" in ('granted', 'objected')),
	CONSTRAINT "consents_grantor_relation_check" CHECK ("consents"."grantor_relation" in ('self', 'guardian')),
	CONSTRAINT "consents_channel_check" CHECK ("consents"."channel" in ('web', 'mobile')),
	CONSTRAINT "consents_withdrawal_reason_check" CHECK ("consents"."withdrawal_reason" is null or "consents"."withdrawal_reason" in ('withdrawn', 'renewed')),
	CONSTRAINT "consents_text_version_check" CHECK ("consents"."text_version" >= 1),
	CONSTRAINT "consents_subject_id_check" CHECK (char_length("consents"."subject_id") between 1 and 200),
	CONSTRAINT "consents_withdrawal_check" CHECK (("consents"."withdrawn_at" is null) = ("consents"."withdrawn_by_user_id" is null)
        and ("consents"."withdrawn_at" is null) = ("consents"."withdrawal_reason" is null)),
	CONSTRAINT "consents_dates_check" CHECK (("consents"."expires_at" is null or "consents"."expires_at" > "consents"."given_at")
        and ("consents"."withdrawn_at" is null or "consents"."withdrawn_at" >= "consents"."given_at"))
);
--> statement-breakpoint
CREATE TABLE "notice_acknowledgements" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notice_acknowledgements_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "notice_acknowledgements_channel_check" CHECK ("notice_acknowledgements"."channel" in ('web', 'mobile')),
	CONSTRAINT "notice_acknowledgements_version_check" CHECK ("notice_acknowledgements"."version" = 1 and "notice_acknowledgements"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "privacy_notices" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"audience" text,
	"purpose" text,
	"notice_version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requires_reconsent" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "privacy_notices_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "privacy_notices_kind_check" CHECK ("privacy_notices"."kind" in ('notice', 'consent_text')),
	CONSTRAINT "privacy_notices_audience_check" CHECK ("privacy_notices"."audience" is null or "privacy_notices"."audience" in ('veli', 'ogrenci', 'personel')),
	CONSTRAINT "privacy_notices_purpose_check" CHECK ("privacy_notices"."purpose" is null or "privacy_notices"."purpose" in ('photo_video_sharing', 'photo_video_website', 'photo_video_social_media', 'photo_video_print', 'promotional_messages', 'speaking_recording')),
	CONSTRAINT "privacy_notices_topic_check" CHECK (("privacy_notices"."kind" = 'notice' and "privacy_notices"."audience" is not null and "privacy_notices"."purpose" is null and not "privacy_notices"."requires_reconsent")
        or ("privacy_notices"."kind" = 'consent_text' and "privacy_notices"."purpose" is not null and "privacy_notices"."audience" is null)),
	CONSTRAINT "privacy_notices_notice_version_check" CHECK ("privacy_notices"."notice_version" >= 1),
	CONSTRAINT "privacy_notices_title_check" CHECK (char_length("privacy_notices"."title") between 1 and 200),
	CONSTRAINT "privacy_notices_body_check" CHECK (char_length("privacy_notices"."body") between 1 and 50000),
	CONSTRAINT "privacy_notices_version_check" CHECK ("privacy_notices"."version" = 1 and "privacy_notices"."archived_at" is null)
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_text_fkey" FOREIGN KEY ("institution_id","text_id") REFERENCES "public"."privacy_notices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_acknowledgements" ADD CONSTRAINT "notice_acknowledgements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_acknowledgements" ADD CONSTRAINT "notice_acknowledgements_notice_fkey" FOREIGN KEY ("institution_id","notice_id") REFERENCES "public"."privacy_notices"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_subject_purpose_decision_key" ON "consents" USING btree ("institution_id","subject_kind","subject_id","purpose","decision") WHERE "consents"."withdrawn_at" is null and "consents"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "consents_subject_idx" ON "consents" USING btree ("institution_id","subject_kind","subject_id","purpose");--> statement-breakpoint
CREATE INDEX "consents_granted_by_idx" ON "consents" USING btree ("institution_id","granted_by_user_id");--> statement-breakpoint
CREATE INDEX "consents_text_idx" ON "consents" USING btree ("institution_id","text_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_acknowledgements_user_notice_key" ON "notice_acknowledgements" USING btree ("institution_id","user_id","notice_id");--> statement-breakpoint
CREATE INDEX "notice_acknowledgements_notice_idx" ON "notice_acknowledgements" USING btree ("institution_id","notice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_audience_version_key" ON "privacy_notices" USING btree ("institution_id","audience","notice_version") WHERE "privacy_notices"."kind" = 'notice';--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_purpose_version_key" ON "privacy_notices" USING btree ("institution_id","purpose","notice_version") WHERE "privacy_notices"."kind" = 'consent_text';--> statement-breakpoint
-- Elle yazıldı: Drizzle şeması ve snapshot tetikleyici ile fonksiyonu izlemez; drizzle-kit yeniden
-- üretirse bu blok yeniden eklenir (veritabani.md §7). İhlal 55000 ile reddedilir; ileti teknik ve
-- İngilizcedir, kullanıcıya gitmez. `delete` yalnız transaction'da
-- `set local kampus.allow_immutable_purge = 'on'` verilince geçer (imha işi).
--
-- Yayımlanmış metin değişmez ve arşivlenmez (DOM-YTK-056, DOM-YTK-060): her `update` reddedilir
-- (0013'teki ortak fonksiyon; `privacy_notices_version_check` arşivli satırın doğrudan yazılmasını
-- da engeller). Arşiv metni listeden düşürüp aynı sürüm numarasını yeniden kullandırır ya da
-- yeniden rıza isteyen sürümü saklayıp eski rızaları geçerli kılardı. Düzeltme yeni sürümdür.
CREATE TRIGGER "privacy_notices_immutable_trigger" BEFORE UPDATE OR DELETE ON "privacy_notices" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "privacy_notices_truncate_trigger" BEFORE TRUNCATE ON "privacy_notices" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
-- Aydınlatma gösterimi bir kez yazılır, hiç değişmez (0013'teki ortak fonksiyon).
CREATE TRIGGER "notice_acknowledgements_immutable_trigger" BEFORE UPDATE OR DELETE ON "notice_acknowledgements" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "notice_acknowledgements_truncate_trigger" BEFORE TRUNCATE ON "notice_acknowledgements" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
-- Rıza kaydı değişmez (DOM-ILT-034, DOM-YTK-059): tek değişiklik geri çekmedir. Geri çekilmemiş
-- satıra geri çekme anı, geri çeken ve neden bir kez yazılır (`updated_at`, `version` ile); başka
-- her `update`, ikinci geri çekme ve arşiv reddedilir.
CREATE FUNCTION "kampus_reject_consent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.withdrawn_at IS NULL
    AND NEW.withdrawn_at IS NOT NULL
    AND NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.subject_kind IS NOT DISTINCT FROM OLD.subject_kind
    AND NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
    AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
    AND NEW.decision IS NOT DISTINCT FROM OLD.decision
    AND NEW.granted_by_user_id IS NOT DISTINCT FROM OLD.granted_by_user_id
    AND NEW.grantor_relation IS NOT DISTINCT FROM OLD.grantor_relation
    AND NEW.text_id IS NOT DISTINCT FROM OLD.text_id
    AND NEW.text_version IS NOT DISTINCT FROM OLD.text_version
    AND NEW.channel IS NOT DISTINCT FROM OLD.channel
    AND NEW.given_at IS NOT DISTINCT FROM OLD.given_at
    AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
    AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: % rows only allow a single withdrawal (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "consents_withdrawal_trigger" BEFORE UPDATE OR DELETE ON "consents" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_consent_change"();--> statement-breakpoint
CREATE TRIGGER "consents_truncate_trigger" BEFORE TRUNCATE ON "consents" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_consent_change"();
