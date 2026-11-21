-- Core `audit` koleksiyonu sunucuda kalıcı tutulmaz (veritabani.md §8, collections.ts): değerleri
-- maskesiz (rehberlik iç notu, sağlık) ve sabit demo kullanıcısıyla taşır. Denetim yalnız
-- `audit_log`'dadır. Önceden yazılmış satırlar arşivlenir (silme = arşiv); çalıştırıcı bu
-- koleksiyonu bir daha yüklemez. İdempotent: yalnız canlı satırlara dokunur.
UPDATE "records"
   SET "archived_at" = now(),
       "updated_at" = now(),
       "version" = "version" + 1
 WHERE "collection" = 'audit'
   AND "archived_at" IS NULL;
