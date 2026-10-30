-- Yazışma mesajları ayrı kayıtlara taşınır (ADR 0005): her mesaj `conversationMessages`
-- koleksiyonunda bir kayıttır; yazışmada yalnız üst veri ve `lastMessageAt` kalır.
--
-- 1. İndeksler: koleksiyonun son sırası (`appendPositions`) ve tek yazışmanın mesajları.
CREATE INDEX "records_institution_collection_position_idx" ON "records" USING btree ("institution_id","collection","position");--> statement-breakpoint
CREATE INDEX "records_conversation_messages_idx" ON "records" USING btree ("institution_id",("data" ->> 'conversationId'),"position","id") WHERE "records"."collection" = 'conversationMessages' and "records"."archived_at" is null;--> statement-breakpoint
-- 2. Gömülü `data.messages` dizileri mesaj kayıtlarına bölünür. Kimlik mesajın kimliğidir; sıra
-- kurum içinde yazışma sırası, sonra dizideki sıradır (mevcut mesaj kayıtlarının sonuna eklenir).
-- Mesaj yazışmanın taraf anahtarlarını kopyalar; arşivli yazışmanın mesajları arşivli kalır.
-- Yalnız kimlikli nesne öğeleri taşınır; çakışan kimlik yazılmaz (adım 3 o yazışmaya dokunmaz).
INSERT INTO "records" ("institution_id", "collection", "id", "data", "position", "version", "created_at", "updated_at", "archived_at")
SELECT src."institution_id",
       'conversationMessages',
       src."message" ->> 'id',
       src."message" || jsonb_strip_nulls(jsonb_build_object(
         'conversationId', to_jsonb(src."conversation_id"),
         'studentId', src."conversation" -> 'studentId',
         'teacherId', src."conversation" -> 'teacherId',
         'audience', src."conversation" -> 'audience',
         'parentUserId', src."conversation" -> 'parentUserId'
       )),
       coalesce(src."last_position", -1024)
         + 1024 * row_number() OVER (
             PARTITION BY src."institution_id"
             ORDER BY src."conversation_position", src."conversation_id", src."ordinality"
           ),
       1,
       src."created_at",
       now(),
       src."archived_at"
  FROM (
    SELECT c."institution_id",
           c."id" AS "conversation_id",
           c."position" AS "conversation_position",
           c."data" AS "conversation",
           c."created_at",
           c."archived_at",
           m."value" AS "message",
           m."ordinality",
           (SELECT max(e."position")
              FROM "records" AS e
             WHERE e."institution_id" = c."institution_id"
               AND e."collection" = 'conversationMessages') AS "last_position"
      FROM "records" AS c
     CROSS JOIN LATERAL jsonb_array_elements(c."data" -> 'messages') WITH ORDINALITY AS m("value", "ordinality")
     WHERE c."collection" = 'conversations'
       AND jsonb_typeof(c."data" -> 'messages') = 'array'
       AND jsonb_typeof(m."value") = 'object'
       AND jsonb_typeof(m."value" -> 'id') = 'string'
  ) AS src
ON CONFLICT ("institution_id", "collection", "id") DO NOTHING;--> statement-breakpoint
-- 3. Dizi, yalnız her öğesi bu yazışmanın mesaj kaydı olarak bulunuyorsa kaldırılır (veri
-- kaybı yok: taşınamayan öğesi olan yazışma olduğu gibi kalır). Son mesajın anı
-- `lastMessageAt` olur. Yalnız `messages` alanı olan kayda dokunur: tekrar çalıştırmak etkisizdir.
UPDATE "records" AS c
   SET "data" = (c."data" - 'messages')
         || jsonb_strip_nulls(jsonb_build_object('lastMessageAt', c."data" -> 'messages' -> -1 -> 'date')),
       "version" = c."version" + 1,
       "updated_at" = now()
 WHERE c."collection" = 'conversations'
   AND jsonb_typeof(c."data" -> 'messages') = 'array'
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(c."data" -> 'messages') AS m("value")
      WHERE NOT EXISTS (
        SELECT 1
          FROM "records" AS r
         WHERE r."institution_id" = c."institution_id"
           AND r."collection" = 'conversationMessages'
           AND r."id" = m."value" ->> 'id'
           AND r."data" ->> 'conversationId' = c."id"
      )
   );
