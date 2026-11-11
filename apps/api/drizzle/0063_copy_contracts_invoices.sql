-- ADR 0010 adım 3 (ON-046e): taksit ve sözleşme `records`'tan tablolara kopyalanır; çalıştırıcı bundan
-- sonra iki yere yazar (`db/finance-mirror-store.ts`), kaynak `records`'tır. Elle yazıldı (veri
-- migration'ı ve işlevler); drizzle-kit şemayı değiştirmediği için snapshot 0062 ile aynıdır.
--
-- 1. Sözleşmesiz eski taksitin bağı (ADR 0010 açık soru 3, #41 Sabah kararı 107). `contractId`'si
--    olmayan taksit önce onu `invoiceIds`'inde taşıyan ilk sürüme (en küçük sürüm numarası, sonra
--    sıra), yoksa öğrencinin tek (arşivlenmemiş) sözleşme kaydına bağlanır; ikisi de yoksa bağ boş
--    kalır. Bağ kaynakta da yazılır (`records.data.contractId`): tablo satırı ile core kaydı birebir
--    kalsın, çift yazma bağı geri silmesin. Sürüm artar (bayat `If-Match` 409 alır). Bağlanınca aynı
--    sözleşme zincirinde aynı taksit numarasını ikinci kez canlı tutacak taksit bağlanmaz
--    (`invoices_installment_key`); o taksit sözleşmesiz kalır. Yalnız `contractId`'siz taksite
--    dokunduğu için tekrar çalışınca hiçbir satır değişmez.
WITH RECURSIVE chain (institution_id, id, root) AS (
  SELECT r."institution_id", r."id", r."id"
    FROM "records" r
   WHERE r."collection" = 'contracts' AND NOT (r."data" ? 'amendsContractId')
  UNION ALL
  SELECT r."institution_id", r."id", ch.root
    FROM "records" r
    JOIN chain ch ON ch.institution_id = r."institution_id" AND r."data" ->> 'amendsContractId' = ch.id
   WHERE r."collection" = 'contracts'
), listed AS (
  SELECT DISTINCT ON (c."institution_id", item.invoice_id)
         c."institution_id", item.invoice_id, c."id" AS contract_id
    FROM "records" c
   CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(c."data" -> 'invoiceIds') = 'array' THEN c."data" -> 'invoiceIds'
                ELSE '[]'::jsonb END) AS item (invoice_id)
   WHERE c."collection" = 'contracts'
   ORDER BY c."institution_id", item.invoice_id,
            CASE WHEN jsonb_typeof(c."data" -> 'revision') = 'number'
                 THEN (c."data" ->> 'revision')::numeric ELSE 1 END, c."position", c."id"
), single AS (
  SELECT c."institution_id", c."data" ->> 'studentId' AS student_id, min(c."id") AS contract_id
    FROM "records" c
   WHERE c."collection" = 'contracts' AND c."archived_at" IS NULL
   GROUP BY c."institution_id", c."data" ->> 'studentId'
  HAVING count(*) = 1
), candidates AS (
  SELECT i."institution_id", i."id", i."data" ->> 'installment' AS installment, i."archived_at",
         coalesce(l.contract_id, s.contract_id) AS contract_id
    FROM "records" i
    LEFT JOIN listed l ON l."institution_id" = i."institution_id" AND l.invoice_id = i."id"
    LEFT JOIN single s ON s."institution_id" = i."institution_id"
                      AND s.student_id = i."data" ->> 'studentId'
   WHERE i."collection" = 'invoices'
     AND NOT (i."data" ? 'contractId')
     AND coalesce(l.contract_id, s.contract_id) IS NOT NULL
), keyed AS (
  SELECT i."institution_id", ch.root, i."data" ->> 'installment' AS installment
    FROM "records" i
    JOIN chain ch ON ch.institution_id = i."institution_id" AND ch.id = i."data" ->> 'contractId'
   WHERE i."collection" = 'invoices' AND i."archived_at" IS NULL
  UNION ALL
  SELECT c."institution_id", ch.root, c.installment
    FROM candidates c
    JOIN chain ch ON ch.institution_id = c."institution_id" AND ch.id = c.contract_id
   WHERE c."archived_at" IS NULL
), clash AS (
  SELECT k."institution_id", k.root, k.installment FROM keyed k
   GROUP BY k."institution_id", k.root, k.installment
  HAVING count(*) > 1
)
UPDATE "records" r
   SET "data" = jsonb_set(r."data", '{contractId}', to_jsonb(c.contract_id)),
       "updated_at" = now(),
       "version" = r."version" + 1
  FROM candidates c
 WHERE r."institution_id" = c."institution_id"
   AND r."collection" = 'invoices'
   AND r."id" = c."id"
   AND NOT (
     c."archived_at" IS NULL AND EXISTS (
       SELECT 1 FROM clash x
         JOIN chain ch ON ch.institution_id = x."institution_id" AND ch.root = x.root
        WHERE x."institution_id" = c."institution_id" AND ch.id = c.contract_id
          AND x.installment = c.installment
     )
   );
--> statement-breakpoint
-- 2. Ayna işlevleri: kurumun `records` taksit ve sözleşmelerini tablolara eşitler (upsert). Dönüşüm
--    `db/contract-store.ts` `contractToColumns` ve `db/invoice-store.ts` `invoiceToColumns` ile
--    aynıdır (eşlik testleri `finance-copy-migration.test.ts`, `finance-mirror.test.ts`). Kimlik,
--    sürüm, sıra, arşiv durumu ve `invoiceIds` sırası kaynaktan gelir; var olan satır yalnız sürümü,
--    sırası ya da arşiv durumu farklıysa güncellenir (tekrar çalıştırmak etkisizdir). Kimlik listesi
--    `NULL` ise kurumun bütün kayıtları.
CREATE FUNCTION "kampus_mirror_contracts"(p_institution_id text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
  WITH RECURSIVE chain (id, root) AS (
    SELECT r."id", r."id" FROM "records" r
     WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
       AND NOT (r."data" ? 'amendsContractId')
    UNION ALL
    SELECT r."id", ch.root FROM "records" r
      JOIN chain ch ON r."data" ->> 'amendsContractId' = ch.id
     WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
  )
  INSERT INTO "contracts" (
    "institution_id", "id", "student_id", "root_contract_id", "amends_contract_id", "revision",
    "academic_year", "class_id", "title", "contract_at", "amount_cents", "tariff_id",
    "tariff_version", "gross_cents", "net_cents", "discounts", "extras",
    "terms_approved_by_user_id", "payer", "scholarship_program_id", "scholarship_cents",
    "signatory_name", "signatory_role", "signatory_recorded_at", "signatory_recorded_by_user_id",
    "approval_method", "approved_at", "approved_by_user_id", "approval_payer_name",
    "approval_plan", "amendment_reason", "proposed_plan", "cancelled_at", "cancelled_by_user_id",
    "cancel_reason", "has_invoice_list", "position", "created_at", "updated_at", "archived_at",
    "version"
  )
  SELECT r."institution_id", r."id", d ->> 'studentId', ch.root, d ->> 'amendsContractId',
         coalesce((d ->> 'revision')::integer, 1), (d ->> 'academicYear')::integer,
         d ->> 'classId', d ->> 'title', (d ->> 'date')::timestamptz, (d ->> 'amount')::bigint,
         (d ->> 'tariffId')::uuid, (d ->> 'tariffVersion')::integer, (d ->> 'grossCents')::bigint,
         (d ->> 'netCents')::bigint, nullif(d -> 'discounts', 'null'::jsonb),
         nullif(d -> 'extras', 'null'::jsonb), d ->> 'approvedByUserId', d ->> 'payer',
         (d -> 'scholarship' ->> 'programId')::uuid,
         (d -> 'scholarship' ->> 'amountCents')::bigint,
         d -> 'signatory' ->> 'name', d -> 'signatory' ->> 'role',
         (d -> 'signatory' ->> 'recordedAt')::timestamptz, d -> 'signatory' ->> 'recordedByUserId',
         d -> 'approval' ->> 'method', (d -> 'approval' ->> 'approvedAt')::timestamptz,
         d -> 'approval' ->> 'approvedByUserId', d -> 'approval' ->> 'payerName',
         nullif(d -> 'approval' -> 'plan', 'null'::jsonb), d ->> 'amendmentReason',
         nullif(d -> 'proposedPlan', 'null'::jsonb), (d ->> 'cancelledAt')::timestamptz,
         d ->> 'cancelledByUserId', d ->> 'cancelReason', d ? 'invoiceIds',
         r."position", r."created_at", r."updated_at", r."archived_at", r."version"
    FROM "records" r
    LEFT JOIN chain ch ON ch.id = r."id"
   CROSS JOIN LATERAL (SELECT r."data" AS d) AS source
   WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
     AND (p_ids IS NULL OR r."id" = ANY (p_ids))
  ON CONFLICT ("institution_id", "id") DO UPDATE SET (
    "student_id", "root_contract_id", "amends_contract_id", "revision", "academic_year",
    "class_id", "title", "contract_at", "amount_cents", "tariff_id", "tariff_version",
    "gross_cents", "net_cents", "discounts", "extras", "terms_approved_by_user_id", "payer",
    "scholarship_program_id", "scholarship_cents", "signatory_name", "signatory_role",
    "signatory_recorded_at", "signatory_recorded_by_user_id", "approval_method", "approved_at",
    "approved_by_user_id", "approval_payer_name", "approval_plan", "amendment_reason",
    "proposed_plan", "cancelled_at", "cancelled_by_user_id", "cancel_reason", "has_invoice_list",
    "position", "updated_at", "archived_at", "version"
  ) = (
    excluded."student_id", excluded."root_contract_id", excluded."amends_contract_id",
    excluded."revision", excluded."academic_year", excluded."class_id", excluded."title",
    excluded."contract_at", excluded."amount_cents", excluded."tariff_id",
    excluded."tariff_version", excluded."gross_cents", excluded."net_cents", excluded."discounts",
    excluded."extras", excluded."terms_approved_by_user_id", excluded."payer",
    excluded."scholarship_program_id", excluded."scholarship_cents", excluded."signatory_name",
    excluded."signatory_role", excluded."signatory_recorded_at",
    excluded."signatory_recorded_by_user_id", excluded."approval_method", excluded."approved_at",
    excluded."approved_by_user_id", excluded."approval_payer_name", excluded."approval_plan",
    excluded."amendment_reason", excluded."proposed_plan", excluded."cancelled_at",
    excluded."cancelled_by_user_id", excluded."cancel_reason", excluded."has_invoice_list",
    excluded."position", excluded."updated_at", excluded."archived_at", excluded."version"
  )
  WHERE ("contracts"."version", "contracts"."position", "contracts"."archived_at")
        IS DISTINCT FROM (excluded."version", excluded."position", excluded."archived_at");
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_mirror_invoices"(p_institution_id text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "invoices" (
    "institution_id", "id", "student_id", "contract_id", "root_contract_id", "academic_year",
    "installment", "fee_kind", "amount_cents", "due_date", "paid_at", "payment_method",
    "reminder_at", "core_created_at", "core_updated_at", "position", "created_at", "updated_at",
    "archived_at", "version"
  )
  SELECT r."institution_id", r."id", d ->> 'studentId', d ->> 'contractId', c."root_contract_id",
         (d ->> 'academicYear')::integer, (d ->> 'installment')::integer, d ->> 'feeKind',
         (d ->> 'amount')::bigint, left(d ->> 'dueDate', 10)::date,
         (d ->> 'paidAt')::timestamptz,
         CASE d ->> 'method'
           WHEN 'Banka havalesi' THEN 'bank_transfer'
           WHEN 'Nakit' THEN 'cash'
           WHEN 'Kredi kartı' THEN 'card'
           WHEN 'Senet' THEN 'promissory_note'
           ELSE d ->> 'method'
         END,
         (d ->> 'reminderAt')::timestamptz, (d ->> 'createdAt')::timestamptz,
         (d ->> 'updatedAt')::timestamptz, r."position", r."created_at", r."updated_at",
         r."archived_at", r."version"
    FROM "records" r
   CROSS JOIN LATERAL (SELECT r."data" AS d) AS source
    LEFT JOIN "contracts" c ON c."institution_id" = r."institution_id"
                           AND c."id" = r."data" ->> 'contractId'
   WHERE r."institution_id" = p_institution_id AND r."collection" = 'invoices'
     AND (p_ids IS NULL OR r."id" = ANY (p_ids))
  ON CONFLICT ("institution_id", "id") DO UPDATE SET (
    "student_id", "contract_id", "root_contract_id", "academic_year", "installment", "fee_kind",
    "amount_cents", "due_date", "paid_at", "payment_method", "reminder_at", "core_created_at",
    "core_updated_at", "position", "updated_at", "archived_at", "version"
  ) = (
    excluded."student_id", excluded."contract_id", excluded."root_contract_id",
    excluded."academic_year", excluded."installment", excluded."fee_kind",
    excluded."amount_cents", excluded."due_date", excluded."paid_at", excluded."payment_method",
    excluded."reminder_at", excluded."core_created_at", excluded."core_updated_at",
    excluded."position", excluded."updated_at", excluded."archived_at", excluded."version"
  )
  WHERE ("invoices"."version", "invoices"."position", "invoices"."archived_at")
        IS DISTINCT FROM (excluded."version", excluded."position", excluded."archived_at");
$$;
--> statement-breakpoint
-- Bağlar `invoiceIds` dizisine eşitlenir: yeni bağ eklenir, sırası değişen ya da geri gelen açılır,
-- düşen arşivlenir (`contract-store.ts` `syncLinks` ile aynı). `invoiceIds`'siz eski kaydın bağı yoktur.
CREATE FUNCTION "kampus_mirror_contract_links"(p_institution_id text, p_ids text[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "contract_invoices" (
    "institution_id", "contract_id", "invoice_id", "position", "created_at", "updated_at"
  )
  SELECT r."institution_id", r."id", item.invoice_id, item.ordinality - 1, r."updated_at",
         r."updated_at"
    FROM "records" r
   CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(r."data" -> 'invoiceIds') = 'array' THEN r."data" -> 'invoiceIds'
                ELSE '[]'::jsonb END) WITH ORDINALITY AS item (invoice_id, ordinality)
   WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
     AND (p_ids IS NULL OR r."id" = ANY (p_ids))
  ON CONFLICT ("institution_id", "contract_id", "invoice_id") DO UPDATE
     SET "position" = excluded."position", "archived_at" = NULL,
         "version" = "contract_invoices"."version" + 1, "updated_at" = excluded."updated_at"
   WHERE "contract_invoices"."position" <> excluded."position"
      OR "contract_invoices"."archived_at" IS NOT NULL;
  UPDATE "contract_invoices" ci
     SET "archived_at" = r."updated_at", "version" = ci."version" + 1, "updated_at" = r."updated_at"
    FROM "records" r
   WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
     AND (p_ids IS NULL OR r."id" = ANY (p_ids))
     AND ci."institution_id" = r."institution_id" AND ci."contract_id" = r."id"
     AND ci."archived_at" IS NULL
     AND NOT (jsonb_typeof(r."data" -> 'invoiceIds') = 'array'
              AND r."data" -> 'invoiceIds' ? ci."invoice_id");
$$;
--> statement-breakpoint
-- Ayna: sözleşmeler, taksitler, bağlar. Önce tek seferde; tabloya sığmayan kaynak kaydı (veri ya da
-- kısıt hatası: SQLSTATE sınıfı 22, 23) varsa kayıt kayıt yeniden denenir ve sığmayanlar atlanır;
-- atlanan sayısı döner. Çift yazma süresince kaynak `records`'tır: sığmayan eski ya da bozuk kayıt
-- işlemi durdurmaz, tabloda yer almaz (okuma geçişinden önce eşlik raporuyla temizlenir, 046f).
-- Onaylı sözleşmenin değişmezlik tetikleyicisi (55000) atlanmaz, işlemi geri alır (DOM-FIN-010).
-- Kimlik listesi `NULL` ise kurumun bütün kayıtları (migration, tohum).
CREATE FUNCTION "kampus_mirror_finance_records"(
  p_institution_id text, p_contract_ids text[] DEFAULT NULL, p_invoice_ids text[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  skipped integer := 0;
  item record;
BEGIN
  BEGIN
    PERFORM "kampus_mirror_contracts"(p_institution_id, p_contract_ids);
    PERFORM "kampus_mirror_invoices"(p_institution_id, p_invoice_ids);
    PERFORM "kampus_mirror_contract_links"(p_institution_id, p_contract_ids);
    RETURN 0;
  EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
    NULL;
  END;
  -- Önceki sürüm ek protokolden önce (yabancı anahtar), sonra kimlik sırası.
  FOR item IN
    SELECT r."id" FROM "records" r
     WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
       AND (p_contract_ids IS NULL OR r."id" = ANY (p_contract_ids))
     ORDER BY CASE WHEN jsonb_typeof(r."data" -> 'revision') = 'number'
                   THEN (r."data" ->> 'revision')::numeric ELSE 1 END, r."id"
  LOOP
    BEGIN
      PERFORM "kampus_mirror_contracts"(p_institution_id, ARRAY[item."id"]);
    EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
      skipped := skipped + 1;
    END;
  END LOOP;
  FOR item IN
    SELECT r."id" FROM "records" r
     WHERE r."institution_id" = p_institution_id AND r."collection" = 'invoices'
       AND (p_invoice_ids IS NULL OR r."id" = ANY (p_invoice_ids))
     ORDER BY r."id"
  LOOP
    BEGIN
      PERFORM "kampus_mirror_invoices"(p_institution_id, ARRAY[item."id"]);
    EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
      skipped := skipped + 1;
    END;
  END LOOP;
  FOR item IN
    SELECT r."id" FROM "records" r
     WHERE r."institution_id" = p_institution_id AND r."collection" = 'contracts'
       AND (p_contract_ids IS NULL OR r."id" = ANY (p_contract_ids))
     ORDER BY r."id"
  LOOP
    BEGIN
      PERFORM "kampus_mirror_contract_links"(p_institution_id, ARRAY[item."id"]);
    EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
      skipped := skipped + 1;
    END;
  END LOOP;
  RETURN skipped;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "kampus_mirror_contracts"(text, text[]) IS 'Kurumun records sözleşme kayıtlarını (kimlik listesi NULL ise hepsini) contracts tablosuna upsert eder; zincir kökü records zincirinden (ADR 0010 adım 3, ON-046e).';
--> statement-breakpoint
COMMENT ON FUNCTION "kampus_mirror_invoices"(text, text[]) IS 'Kurumun records taksit kayıtlarını invoices tablosuna upsert eder; kök contracts tablosundan (ADR 0010 adım 3, ON-046e).';
--> statement-breakpoint
COMMENT ON FUNCTION "kampus_mirror_contract_links"(text, text[]) IS 'Sözleşme kayıtlarının invoiceIds dizisini contract_invoices bağlarına eşitler: ekler, sıralar, düşeni arşivler (ADR 0010 adım 3, ON-046e).';
--> statement-breakpoint
COMMENT ON FUNCTION "kampus_mirror_finance_records"(text, text[], text[]) IS 'Çift yazma aynası: taksit ve sözleşmeyi records kaynağından tablolara eşitler; tabloya sığmayan kayıt (SQLSTATE 22, 23) atlanır ve sayısı döner, 55000 işlemi geri alır (ADR 0010 adım 3, ON-046e).';
--> statement-breakpoint
-- 3. Bütün kurumların kopyası.
SELECT "kampus_mirror_finance_records"("id") FROM "institutions";
