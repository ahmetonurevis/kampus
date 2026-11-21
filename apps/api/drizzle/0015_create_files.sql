CREATE TABLE "files" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"duration_ms" integer,
	"original_name" text,
	"uploaded_by_user_id" text NOT NULL,
	"data_subject_id" text,
	"attached_type" text,
	"attached_id" text,
	"attached_at" timestamp with time zone,
	"retention_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "files_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('submission', 'material', 'question_image', 'listening_audio', 'speaking_recording', 'document')),
	CONSTRAINT "files_status_check" CHECK ("files"."status" in ('pending', 'processing', 'ready', 'rejected', 'deleted')),
	CONSTRAINT "files_byte_size_check" CHECK ("files"."byte_size" > 0),
	CONSTRAINT "files_sha256_check" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_duration_ms_check" CHECK ("files"."duration_ms" is null or "files"."duration_ms" >= 0),
	CONSTRAINT "files_attached_check" CHECK (("files"."attached_type" is null) = ("files"."attached_id" is null) and ("files"."attached_id" is null) = ("files"."attached_at" is null)),
	CONSTRAINT "files_deleted_check" CHECK (("files"."status" = 'deleted') = ("files"."deleted_at" is not null)),
	CONSTRAINT "files_version_check" CHECK ("files"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "institution_settings" ADD COLUMN "storage_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_key" ON "files" USING btree ("institution_id","storage_key");--> statement-breakpoint
CREATE INDEX "files_attached_idx" ON "files" USING btree ("institution_id","attached_type","attached_id") WHERE "files"."attached_id" is not null;--> statement-breakpoint
CREATE INDEX "files_unattached_idx" ON "files" USING btree ("institution_id","created_at") WHERE "files"."attached_id" is null and "files"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "files_data_subject_idx" ON "files" USING btree ("institution_id","data_subject_id") WHERE "files"."data_subject_id" is not null;--> statement-breakpoint
CREATE INDEX "files_uploaded_by_idx" ON "files" USING btree ("institution_id","uploaded_by_user_id");--> statement-breakpoint
ALTER TABLE "institution_settings" ADD CONSTRAINT "institution_settings_storage_quota_bytes_check" CHECK ("institution_settings"."storage_quota_bytes" is null or "institution_settings"."storage_quota_bytes" > 0);--> statement-breakpoint
-- Elle yazıldı: Drizzle şeması ve snapshot tetikleyici ile fonksiyonu izlemez; drizzle-kit yeniden
-- üretirse bu blok yeniden eklenir. Dosya satırının içerik kolonları (kurum, kimlik, amaç, depo
-- anahtarı, tür, boyut, özet, yükleyen, oluşturma zamanı) değişmez: değiştiren `update` 55000 ile
-- reddedilir; durum, bağlama, saklama ve silme kolonları serbesttir (ADR 0003 karar 4, 5, 13).
-- Satır silinmez (imha nesneyi siler, satır `deleted` kalır); `delete` yalnız transaction'da
-- `set local kampus.allow_immutable_purge = 'on'` verilince geçer (veritabani.md §7).
CREATE FUNCTION "kampus_reject_file_content_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
    AND NEW.storage_key IS NOT DISTINCT FROM OLD.storage_key
    AND NEW.content_type IS NOT DISTINCT FROM OLD.content_type
    AND NEW.byte_size IS NOT DISTINCT FROM OLD.byte_size
    AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256
    AND NEW.uploaded_by_user_id IS NOT DISTINCT FROM OLD.uploaded_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: % content is immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "files_content_trigger" BEFORE UPDATE OR DELETE ON "files" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_file_content_change"();--> statement-breakpoint
CREATE TRIGGER "files_truncate_trigger" BEFORE TRUNCATE ON "files" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_file_content_change"();
