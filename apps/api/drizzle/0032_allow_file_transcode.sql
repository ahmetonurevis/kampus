-- Ses dönüştürmenin içerik geçişi (OG-262; ADR 0003 karar 4, 10). Numara 0032 görev satırında
-- ayrıldı. Elle yazıldı: Drizzle tetikleyici işlevini izlemez (migration 0015).
--
-- `media.transcode` işi `processing` dosyayı dönüştürülmüş nesneye çevirip `ready` yapar; o geçişte
-- depo anahtarı, tür, boyut ve özet yeni nesneninkidir. İçerik kolonları yalnız bu tek geçişte
-- (`processing` → `ready`, aynı güncellemede) değişebilir; kurum, kimlik, amaç, yükleyen ve
-- oluşturma zamanı hiçbir zaman değişmez. Başka her güncelleme eskisi gibi 55000 ile reddedilir;
-- `delete` yalnız `kampus.allow_immutable_purge` ayarıyla geçer.
CREATE OR REPLACE FUNCTION "kampus_reject_file_content_change"() RETURNS trigger
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
    AND NEW.uploaded_by_user_id IS NOT DISTINCT FROM OLD.uploaded_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (
      (OLD.status = 'processing' AND NEW.status = 'ready')
      OR (
        NEW.storage_key IS NOT DISTINCT FROM OLD.storage_key
        AND NEW.content_type IS NOT DISTINCT FROM OLD.content_type
        AND NEW.byte_size IS NOT DISTINCT FROM OLD.byte_size
        AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256
      )
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: % content is immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
