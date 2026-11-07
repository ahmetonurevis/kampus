-- Ses dönüştürme (OG-262; ADR 0003 karar 4, 10). Numara 0033 görev satırında ayrıldı. Kolon,
-- kısıt ve indeks Drizzle şemasından üretildi; tetikleyici işlevi elle eklendi (Drizzle
-- tetikleyici işlevini izlemez, migration 0015).
--
-- `superseded_storage_key`: dönüşümle yerini yeni nesneye bırakan özgün nesnenin anahtarı;
-- `processing` → `ready` güncellemesinde yazılır, nesne silinince boşalır. Silinemeyen özgün nesne
-- böylece izlenir ve temizlik onu da siler. Kolon boş eklenir; tablo dönüşümden önce bu kolonu
-- doldurmadığından kısıt tek adımda doğrulanır.
ALTER TABLE "files" ADD COLUMN "superseded_storage_key" text;--> statement-breakpoint
CREATE INDEX "files_superseded_idx" ON "files" USING btree ("institution_id","id") WHERE "files"."superseded_storage_key" is not null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_superseded_storage_key_check" CHECK ("files"."superseded_storage_key" is null or "files"."superseded_storage_key" <> "files"."storage_key");--> statement-breakpoint
--
-- `media.transcode` işi `processing` ses dosyasını dönüştürülmüş nesneye çevirip `ready` yapar; o
-- geçişte depo anahtarı, tür, boyut ve özet yeni nesneninkidir. İçerik kolonları yalnız ses
-- amaçlarında (`speaking_recording`, `listening_audio`) ve yalnız bu tek geçişte (`processing` →
-- `ready`, aynı güncellemede) değişebilir. Hiçbir güncelleme dosyayı `processing`'e geri götüremez
-- (dosya `processing` yalnız eklenirken başlar): `ready` dosyayı önce `processing` yapıp sonra
-- içeriğini değiştirmek (iki adımlı delme) böylece kapanır. Kurum, kimlik, amaç, yükleyen ve
-- oluşturma zamanı hiçbir zaman değişmez. Başka her güncelleme eskisi gibi 55000 ile reddedilir;
-- `delete` yalnız `kampus.allow_immutable_purge` ayarıyla geçer. `superseded_storage_key` yalnız
-- dönüşüm geçişinde özgün anahtarla dolar, sonra yalnız boşalır.
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
    transcoded := OLD.purpose IN ('speaking_recording', 'listening_audio')
      AND OLD.status = 'processing'
      AND NEW.status = 'ready';
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
      -- boşaltılabilir: başka bir nesnenin anahtarı silinmek üzere işaretlenemez.
      AND (
        NEW.superseded_storage_key IS NOT DISTINCT FROM OLD.superseded_storage_key
        OR NEW.superseded_storage_key IS NULL
        OR (transcoded AND NEW.superseded_storage_key = OLD.storage_key)
      ) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'kampus: % content is immutable (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
