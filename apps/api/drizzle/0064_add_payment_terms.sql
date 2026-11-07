ALTER TABLE "contracts" ADD COLUMN "payment_term" jsonb;--> statement-breakpoint
ALTER TABLE "fee_tariffs" ADD COLUMN "payment_terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_payment_term_check" CHECK ("contracts"."payment_term" is null or "contracts"."tariff_id" is not null);--> statement-breakpoint
-- Onaylı ya da iptal edilmiş sürümün koşulları donar (ADR 0010 karar 4; DOM-FIN-010): tetikleyici
-- kolonları açıkça saydığı için yeni `payment_term` listeye eklenir, liste 0061'dekiyle aynıdır.
DROP TRIGGER "contracts_settled_immutable_trigger" ON "contracts";
--> statement-breakpoint
CREATE TRIGGER "contracts_settled_immutable_trigger" BEFORE UPDATE ON "contracts" FOR EACH ROW
WHEN (
  (OLD."approved_at" IS NOT NULL OR OLD."cancelled_at" IS NOT NULL)
  AND (
    OLD."institution_id", OLD."id", OLD."student_id", OLD."root_contract_id", OLD."amends_contract_id",
    OLD."revision", OLD."academic_year", OLD."title", OLD."contract_at", OLD."amount_cents",
    OLD."currency", OLD."tariff_id", OLD."tariff_version", OLD."gross_cents", OLD."net_cents",
    OLD."discounts", OLD."extras", OLD."terms_approved_by_user_id", OLD."payer",
    OLD."scholarship_program_id", OLD."scholarship_cents", OLD."payment_term", OLD."signatory_name",
    OLD."signatory_role", OLD."signatory_recorded_at", OLD."signatory_recorded_by_user_id",
    OLD."approval_method", OLD."approved_at", OLD."approved_by_user_id", OLD."approval_payer_name",
    OLD."approval_plan", OLD."amendment_reason", OLD."proposed_plan", OLD."cancelled_at",
    OLD."cancelled_by_user_id", OLD."cancel_reason", OLD."has_invoice_list", OLD."created_at",
    OLD."archived_at"
  ) IS DISTINCT FROM (
    NEW."institution_id", NEW."id", NEW."student_id", NEW."root_contract_id", NEW."amends_contract_id",
    NEW."revision", NEW."academic_year", NEW."title", NEW."contract_at", NEW."amount_cents",
    NEW."currency", NEW."tariff_id", NEW."tariff_version", NEW."gross_cents", NEW."net_cents",
    NEW."discounts", NEW."extras", NEW."terms_approved_by_user_id", NEW."payer",
    NEW."scholarship_program_id", NEW."scholarship_cents", NEW."payment_term", NEW."signatory_name",
    NEW."signatory_role", NEW."signatory_recorded_at", NEW."signatory_recorded_by_user_id",
    NEW."approval_method", NEW."approved_at", NEW."approved_by_user_id", NEW."approval_payer_name",
    NEW."approval_plan", NEW."amendment_reason", NEW."proposed_plan", NEW."cancelled_at",
    NEW."cancelled_by_user_id", NEW."cancel_reason", NEW."has_invoice_list", NEW."created_at",
    NEW."archived_at"
  )
)
EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TRIGGER "contracts_settled_immutable_trigger" ON "contracts" IS 'Onaylı ya da iptal edilmiş sürümde class_id, position, version ve updated_at dışındaki kolonların değişmesini reddeder (ADR 0010 karar 4; IST-092, DOM-FIN-010).';
--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."payment_terms" IS 'İlan edilen peşin ve süreli ödeme koşulları (DOM-FIN-013): koşul türü, taksit aralığı ve isteğe bağlı indirim. Yayımlanan sürümde değişmez; bu kolondan önce yayımlanmış tarifede boş dizidir ve taksit sayısı sınırlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "contracts"."payment_term" IS 'Sözleşmenin dayandığı ilanlı ödeme koşulunun kopyası ve seçilen taksit sayısı (DOM-FIN-013); tarife değişse de kalır. Koşulsuz eski tarifede ve tarifesiz sözleşmede boş.';
--> statement-breakpoint
COMMENT ON CONSTRAINT "contracts_payment_term_check" ON "contracts" IS 'Ödeme koşulu yalnız tarifeli sözleşmede bulunur.';
