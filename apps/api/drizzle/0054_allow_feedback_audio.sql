-- Öğretmenin sesli geri bildirimi dosya amacı (OG-084; IST-052, DOM-BEC-056, ADR 0003 karar 3).
-- Kısıt Drizzle şemasından (core `FILE_PURPOSES`) üretildi. Amaç yalnız eklenir; var olan
-- satırların amacı listede kaldığından kısıt tek adımda doğrulanır. Tetikleyici işlevi elle
-- eklendi (Drizzle izlemez): sesli geri bildirim de `media.transcode` ile dönüşür, içerik
-- kolonlarının dönüşüm geçişi bu amaçta da açılır. İşlevin geri kalanı migration 0042'deki gibidir.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('submission', 'material', 'question_image', 'student_question_photo', 'listening_audio', 'speaking_recording', 'feedback_audio', 'document', 'absence_document'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kampus_reject_file_content_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transcoded boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('kampus.allow_immutable_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    transcoded := OLD.purpose IN ('speaking_recording', 'listening_audio', 'feedback_audio')
      AND OLD.status = 'processing'
      AND OLD.superseded_storage_key IS NULL
      AND (
        NEW.status = 'ready'
        OR (
          NEW.status = 'processing'
          AND OLD.scan_pending
          AND NEW.scan_pending
          AND NEW.superseded_storage_key IS NOT DISTINCT FROM OLD.storage_key
        )
      );
    IF NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
      AND NEW.uploaded_by_user_id IS NOT DISTINCT FROM OLD.uploaded_by_user_id
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND NOT (NEW.status = 'processing' AND OLD.status IS DISTINCT FROM 'processing')
      AND (
        transcoded
        OR (
          NEW.storage_key IS NOT DISTINCT FROM OLD.storage_key
          AND NEW.content_type IS NOT DISTINCT FROM OLD.content_type
          AND NEW.byte_size IS NOT DISTINCT FROM OLD.byte_size
          AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256
        )
      )
      -- Silinecek özgün anahtar yalnız dönüşüm geçişinde eski anahtar olarak yazılır, sonra yalnız
      -- boşaltılabilir: başka bir nesnenin anahtarı silinmek üzere işaretlenemez. Taraması süren
      -- (`processing`) dönüşmüş satırda anahtar boşaltılamaz: tarama özgün nesneyi okur ve boş
      -- anahtar satırı yeniden dönüştürülebilir gösterirdi.
      AND (
        NEW.superseded_storage_key IS NOT DISTINCT FROM OLD.superseded_storage_key
        OR (NEW.superseded_storage_key IS NULL AND NEW.status <> 'processing')
        OR (transcoded AND NEW.superseded_storage_key = OLD.storage_key)
      ) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'kampus: % content is immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
