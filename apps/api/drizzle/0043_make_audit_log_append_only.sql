-- OG-200: `audit_log` yalnız eklemeyle büyür (veritabani.md §8). Elle yazıldı: Drizzle şeması ve
-- snapshot tetikleyici ile fonksiyonu izlemez; drizzle-kit yeniden üretirse bu blok yeniden eklenir.
--
-- Satır düzeyinde `update`/`delete` ve deyim düzeyinde `truncate` 55000 (object_not_in_prerequisite_state)
-- ile reddedilir. Uygulama yerelde ve testte tablo sahibi rolle bağlandığı için `revoke` korumaz;
-- tetikleyici her rolde çalışır. Süper kullanıcı isteyen `session_replication_role` kullanılmaz.
-- Üretimde yalnız-ekleme veritabanı rolü (grant/revoke) ek katman olarak ayrı kararla gelir.
--
-- Ortak `kampus_reject_immutable_change()` (migration 0013) burada kullanılmaz: o işlev imha işi için
-- `kampus.allow_immutable_purge = 'on'` ile `delete`'e izin verir. Kodda `audit_log`'u güncelleyen ya
-- da silen meşru bir yol yoktur (saklama süresi henüz belirlenmedi, KVKK imha ve anonimleştirme
-- işleri bu tabloyu silmez; `idempotency.purge` ve `files.purge-*` işleri başka tabloya yazar), bu
-- yüzden istisna açılmaz; ayrı işlev, imha ayarı bir transaction'da açık kalsa bile denetim satırının
-- silinmesini engeller. Saklama süresi gelen satırların silinmesi gerekirse dar istisna (ör. işlem içi
-- ayar) ve saklama kararı o iş ile birlikte, bu işlevin değiştirilmesiyle eklenir.
--
-- Sonuç: `institution_id`'nin `on delete set null` yabancı anahtarı kurum silinirken `audit_log`
-- satırlarını güncellemeye kalkar; o güncelleme de reddedildiğinden denetim kaydı olan bir kurum
-- silinemez. Kurum silme API'de yoktur; platform bakım betiği ayrı bir saklama kararı ister.
CREATE FUNCTION "kampus_reject_audit_log_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kampus: % rows are append-only (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_immutable_trigger" BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_audit_log_change"();--> statement-breakpoint
CREATE TRIGGER "audit_log_truncate_trigger" BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_audit_log_change"();
