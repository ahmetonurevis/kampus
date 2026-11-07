-- Elle eklendi: core yalnız `FEE_ITEM_KINDS` anahtarı yazar (DOM-FIN-004); etiket (`Öğrenim ücreti`)
-- hiçbir yolda (kayıt, yenileme, paket, iptal, ek protokol, ON-060 aktarımı) yazılmaz. Alanı
-- olmayan eski kayıt boş kalır, kısıt boşu kabul eder. Bu yüzden ayna (`kampus_mirror_invoices`)
-- değişmez, eşleme gerekmez; uymayan kayıt aynada atlanır (SQLSTATE 23, migration 0063) ve depo
-- şeması (`invoiceRecordSchema`) onu zaten süzer.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fee_kind_check" CHECK ("invoices"."fee_kind" in ('tuition', 'breakfast', 'meal', 'transport', 'dormitory', 'stationery', 'uniform', 'tutoring'));--> statement-breakpoint
COMMENT ON COLUMN "invoices"."fee_kind" IS 'Kalem türü anahtarı: tuition (öğrenim), breakfast, meal, transport, dormitory, stationery, uniform, tutoring (core FEE_ITEM_KINDS, DOM-FIN-004); core kaydında alan yoksa boş (eski kayıt, öğrenim sayılır).';--> statement-breakpoint
COMMENT ON CONSTRAINT "invoices_fee_kind_check" ON "invoices" IS 'Kalem türü core FEE_ITEM_KINDS listesindedir ya da boştur; liste değişirse kısıt yeni migration ile güncellenir (ON-316).';
