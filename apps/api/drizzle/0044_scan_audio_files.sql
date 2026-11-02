-- Ses dosyalarının virüs taraması (OG-988; ADR 0003 karar 8, 10). Numara 0044 görev satırında
-- ayrıldı (0041 ve 0042 başka göreve ayrıldı). Kolon ve kısıt Drizzle şemasından üretildi;
-- tetikleyici işlevi elle eklendi (Drizzle tetikleyici işlevini izlemez, migration 0015, 0033).
--
-- `scan_pending`: tarayıcı açıkken yüklenen sesin taraması sürüyor. Dönüşüm taramayı beklemez;
-- dosya ancak tarama temiz çıkınca ve dönüşüm bitince `ready` olur, ikisinden sonra biten `ready`'yi
-- yazar. Kolon `false` varsayılanıyla eklenir: var olan satırlar (ses dışı, taramasız ses) eskisi
-- gibi davranır. Var olan bütün satırlar `false` olduğundan kısıt tek adımda doğrulanır (tablo
-- henüz üretimde değil; migration 0033'teki gerekçe).
ALTER TABLE "files" ADD COLUMN "scan_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_scan_pending_check" CHECK (not "files"."scan_pending" or "files"."status" <> 'ready');--> statement-breakpoint
--
-- İçerik kolonlarının ses dönüşümündeki tek geçişi (migration 0033) taramayla birlikte iki biçim
-- alır: tarama bitmişse ya da yoksa dönüşüm eskisi gibi `processing` → `ready` yazar; tarama
-- sürüyorsa dönüşüm içeriği değiştirir ama dosya `processing` kalır (`processing` → `processing`),
-- `ready`'yi sonra tarama içerik değişmeden yazar. Kalan `processing` biçimi yalnız taraması süren
-- (`scan_pending`) satırda ve özgün anahtar aynı güncellemede ize (`superseded_storage_key`)
-- geçerken geçerlidir. Geçiş yalnız henüz dönüşmemiş satırda (iz boş) bir kez yapılabilir:
-- dönüşmüş ama taranmamış satırın içeriği ikinci kez değiştirilemez, özgün anahtar başka bir
-- nesneyle değiştirilemez. Öteki kurallar migration 0033'teki gibidir: hiçbir güncelleme dosyayı
-- `processing`'e geri götüremez; kurum, kimlik, amaç, yükleyen ve oluşturma zamanı değişmez;
-- `delete` yalnız `kampus.allow_immutable_purge` ayarıyla.
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
