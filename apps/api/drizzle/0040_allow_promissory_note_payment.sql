-- Senetle tahsilat (ON-018, IST-106). Yöntem yalnız eklenir; var olan satırlar listede kaldığından
-- kısıt tek adımda doğrulanır.
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('bank_transfer', 'cash', 'card', 'promissory_note'));--> statement-breakpoint
COMMENT ON COLUMN "payments"."method" IS 'Yöntem: bank_transfer, cash, card, promissory_note. Nakit kurum ayarına bağlıdır; senet banka hesabına bağlanmaz, referansı senet numarasıdır.';
