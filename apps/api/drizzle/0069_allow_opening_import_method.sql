ALTER TABLE "invoices" DROP CONSTRAINT "invoices_payment_method_check";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_method_check" CHECK ("invoices"."payment_method" in ('bank_transfer', 'cash', 'card', 'promissory_note', 'opening_import'));--> statement-breakpoint
-- Dosyadan aktarılan geçmiş ödeme (DOM-FIN-014) `records`'ta `Açılış aktarımı` etiketiyle de durur:
-- ayna onu anahtara çevirmezse etiket `invoices_payment_method_check`'e takılır. Gövde 0063 ile
-- aynıdır, yalnız bu eşleme eklenir.
CREATE OR REPLACE FUNCTION "kampus_mirror_invoices"(p_institution_id text, p_ids text[]) RETURNS void
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
           WHEN 'Açılış aktarımı' THEN 'opening_import'
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
COMMENT ON COLUMN "invoices"."payment_method" IS 'Son ödemenin yöntem anahtarı (bank_transfer, cash, card, promissory_note) ya da opening_import: dosyadan aktarılan geçmiş ödeme; tahsilat satırı yoktur, kasayı değiştirmez, ödendi görünür (DOM-FIN-014). Core etiketinin karşılığı.';
