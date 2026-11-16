-- Elle yazıldı (ON-142, DOM-FIN-098). Migration 0109'un `not valid` eklediği genişletilmiş
-- `invoices_fee_kind_check` kısıtı doğrulanır. `validate constraint` yalnız SHARE UPDATE EXCLUSIVE
-- kilidi alır; okuma ve yazma sürer. Yeni kısıt eskisinden geniştir (`activity` eklendi): 0073'te
-- doğrulanmış satırların hepsi ona uyar. Drizzle bekleyen migration'ları tek transaction'da
-- uygular; kilit kazancı için 0109 ve 0110 ayrı yayınlarda uygulanır (0072/0073 ile aynı yol).
-- Şema değişmez, `db:generate` fark üretmez.
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_fee_kind_check";
