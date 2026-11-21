-- Onaylı sözleşme değişmez (IST-092, DOM-FIN-010): tutar, koşullar, imza yetkilisi ve onay kopyası
-- yazıldıktan sonra güncellenemez; değişiklik ek protokolle yeni kayıttır. Yalnız iki canlı bağ
-- değişebilir: ayrılış kalan taksitleri `invoiceIds`'ten düşer, sınıf arşivi planlı yenilemenin
-- `classId`'sini aktarır. Onay kopyası bunlardan etkilenmez. Sözleşmeler `records`'ta olduğu için
-- tetikleyici koşulludur; öteki koleksiyonların yazımına maliyeti `WHEN` denetimidir (0013'teki ortak
-- fonksiyon, 55000).
CREATE TRIGGER "records_approved_contract_immutable_trigger" BEFORE UPDATE ON "records" FOR EACH ROW
WHEN (
  OLD."collection" = 'contracts'
  AND OLD."data" ? 'approval'
  AND (OLD."data" - 'invoiceIds' - 'classId') IS DISTINCT FROM (NEW."data" - 'invoiceIds' - 'classId')
)
EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
COMMENT ON TRIGGER "records_approved_contract_immutable_trigger" ON "records" IS 'Onaylı sözleşme kaydının invoiceIds ve classId dışındaki alanlarının değişmesini reddeder (IST-092, DOM-FIN-010).';
