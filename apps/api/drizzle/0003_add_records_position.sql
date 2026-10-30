-- Kayıtların core dizisindeki sırası (veritabani.md §3). Önce boş kolon, sonra dolgu, sonra not null.
ALTER TABLE "records" ADD COLUMN "position" bigint;
--> statement-breakpoint
-- Mevcut satırlar kimlik sırasıyla numaralanır: bu, sıra kolonundan önce deponun
-- yüklediği sıradır (koleksiyon, kimlik), dolayısıyla migration görünür sırayı değiştirmez. Core
-- dizisinin sırası SQL'de bilinemez (fiziksel konum `ctid` çok satırlı eklemede de güvenilir değil);
-- tohumu yeniden çalıştırmak tohum kayıtlarını core sırasına getirir (`insertMissingRecords`, yalnız
-- sıra değeri yazılır). Adım 1024: `POSITION_STEP`. İdempotent: yalnız boş satırları doldurur.
UPDATE "records" AS r
   SET "position" = n."position"
  FROM (
    SELECT "institution_id", "collection", "id",
           (row_number() OVER (
              PARTITION BY "institution_id", "collection"
              ORDER BY "id"
            ) - 1) * 1024 AS "position"
      FROM "records"
  ) AS n
 WHERE r."institution_id" = n."institution_id"
   AND r."collection" = n."collection"
   AND r."id" = n."id"
   AND r."position" IS NULL;
--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "position" SET NOT NULL;
