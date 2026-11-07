ALTER TABLE "student_withdrawals" DROP CONSTRAINT "student_withdrawals_reason_check";--> statement-breakpoint
-- Elle eklendi: sağlık özel nitelikli veridir, eski satırlar da belgeli nedene döner (K-30).
UPDATE "student_withdrawals" SET "reason" = 'documented' WHERE "reason" = 'health';--> statement-breakpoint
ALTER TABLE "student_withdrawals" ADD CONSTRAINT "student_withdrawals_reason_check" CHECK ("student_withdrawals"."reason" in ('transfer', 'relocation', 'documented', 'financial', 'dissatisfaction', 'other'));--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."reason" IS 'Neden: transfer, relocation, documented (belgeli neden; sağlık ayrıntısı tutulmaz, K-30), financial, dissatisfaction, other.';
