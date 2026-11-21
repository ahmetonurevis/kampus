-- Veli tarafı yazışma artık yalnız kayıtlı veli kimliğinin (`parentUserId`) sahibine görünür
-- (DOM-ILT-010); kimliksiz eski kayıt hiçbir veliye açılmaz. Öğrencinin platformda tam olarak
-- bir veli hesabı varsa (`membership_links` kind `child`, rol `veli`) eski yazışma o hesapla
-- doldurulur; hiç veya birden çok hesap varsa kimlik boş kalır (kapalı başarısız, yönetici
-- gerekçeli erişimle okur). İdempotent: yalnız kimliksiz canlı veli yazışmasına dokunur.
UPDATE "records" AS r
   SET "data" = jsonb_set(r."data", '{parentUserId}', to_jsonb(only_parent."user_id")),
       "updated_at" = now(),
       "version" = r."version" + 1
  FROM (
    SELECT l."institution_id", l."record_id" AS "student_id", min(m."user_id") AS "user_id"
      FROM "membership_links" AS l
      JOIN "memberships" AS m
        ON m."id" = l."membership_id" AND m."institution_id" = l."institution_id"
     WHERE l."kind" = 'child'
       AND m."role" = 'veli'
     GROUP BY l."institution_id", l."record_id"
    HAVING count(DISTINCT m."user_id") = 1
  ) AS only_parent
 WHERE r."collection" = 'conversations'
   AND r."archived_at" IS NULL
   AND r."data" ->> 'audience' = 'parent'
   AND r."data" ->> 'parentUserId' IS NULL
   AND r."institution_id" = only_parent."institution_id"
   AND r."data" ->> 'studentId' = only_parent."student_id";
