ALTER TABLE "finance_day_closings" DROP CONSTRAINT "finance_day_closings_net_check";--> statement-breakpoint
ALTER TABLE "finance_day_closings" ADD COLUMN "refund_paid_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_day_closings" ADD COLUMN "refund_paid_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_withdrawals" ADD COLUMN "refund_bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "student_withdrawals" ADD CONSTRAINT "student_withdrawals_refund_bank_account_fkey" FOREIGN KEY ("institution_id","refund_bank_account_id") REFERENCES "public"."bank_accounts"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_withdrawals_refund_bank_account_idx" ON "student_withdrawals" USING btree ("institution_id","refund_bank_account_id");--> statement-breakpoint
CREATE INDEX "student_withdrawals_refund_paid_idx" ON "student_withdrawals" USING btree ("institution_id","refund_paid_date");--> statement-breakpoint
ALTER TABLE "finance_day_closings" ADD CONSTRAINT "finance_day_closings_net_check" CHECK ("finance_day_closings"."net_cents" = "finance_day_closings"."collected_cents" - "finance_day_closings"."reversed_cents" - "finance_day_closings"."refund_paid_cents");--> statement-breakpoint
ALTER TABLE "student_withdrawals" ADD CONSTRAINT "student_withdrawals_refund_bank_account_check" CHECK ("student_withdrawals"."refund_bank_account_id" is null or "student_withdrawals"."refund_paid_date" is not null);--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."refund_paid_count" IS 'O gün ödeme tarihli ayrılış iadesi adedi (M-13, DOM-FIN-041); iade banka yönteminde sayılır. Bu kolondan önceki kapanışlarda 0.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."refund_paid_cents" IS 'O gün ödenen ayrılış iadelerinin toplamı (kuruş); netten düşer, kasa beklenenine girmez. Bu kolondan önceki kapanışlarda 0.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."net_cents" IS 'Tahsilat eksi iptal eksi iade ödemesi (kuruş); kısıtla eşitlenir.';--> statement-breakpoint
COMMENT ON COLUMN "finance_day_closings"."method_totals" IS 'Yöntem bazında özet: payments.method anahtarı, tahsilat, iptal ve iade ödemesi adedi ile kuruş tutarı, net. İade alanları yalnız banka havalesi satırında dolar; 0083 öncesi satırlarda yoktur, 0 okunur.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_bank_account_id" IS 'İadenin ödendiği kurum banka hesabı (bank_accounts, DOM-FIN-032, M-13); ödemede zorunlu, ödenmemiş iadede ve 0083 öncesi ödenmiş iadede boş.';
