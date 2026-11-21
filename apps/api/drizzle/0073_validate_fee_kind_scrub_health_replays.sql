-- Elle yazıldı (ON-318). İki ayrı düzeltme; şema değişmez, `db:generate` fark üretmez.
--
-- 1) Migration 0072'nin `not valid` eklediği `invoices_fee_kind_check` kısıtı doğrulanır
--    (DOM-FIN-004). `validate constraint` yalnız SHARE UPDATE EXCLUSIVE kilidi alır; okuma ve
--    yazma sürer. Kural dışı eski satır varsa migration burada durur: satır düzeltilip yeniden
--    çalıştırılır (0072 geri alınmaz). Kısıt zaten doğrulanmışsa (0072'nin eski hâlini uygulamış
--    yerel veritabanı) komut etkisizdir. Drizzle bekleyen bütün migration'ları tek transaction'da
--    uygular: 0072 ile aynı yayında çalışırsa 0072'nin ACCESS EXCLUSIVE kilidi doğrulama bitene
--    dek sürer; kilit kazancı için 0072 ve 0073 ayrı yayınlarda uygulanır.
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_fee_kind_check";--> statement-breakpoint
-- 2) Migration 0071 (ON-303, K-30) ayrılış nedeninde `health`'i `documented`'a çevirdi; ama
--    `idempotency_keys` ayrılış (`withdraw`, 201) ve iade (`pay-refund`, 200) yanıtlarını 24 saate
--    kadar saklar ve tekrarda aynen döndürür. Eski gövde `reason: 'health'` taşırsa yanıt şeması
--    onu reddeder (tekrar 500 olur) ve sağlık bilgisi kayıtta kalır. Saklanan gövde, ayrılış
--    kaydının bugünkü hâliyle aynı değere çevrilir: tekrar yine ilk işlemin başarı yanıtını verir,
--    işlem yeniden çalışmaz (silmek anahtarı boşa çıkarır, istemcinin tekrarı 409 alırdı).
--    Yalnız ayrılış yanıtı şekli (`refundDueDate`, `breakdown`, `refundStatus`) seçilir; başka
--    uçların `reason` alanına (ör. devamsızlık kategorisi `health`) dokunulmaz.
UPDATE "idempotency_keys"
SET "response_body" = jsonb_set("response_body", '{data,reason}', '"documented"'::jsonb)
WHERE "response_body" #>> '{data,reason}' = 'health'
  AND jsonb_typeof("response_body" -> 'data') = 'object'
  AND ("response_body" -> 'data') ?& array['refundDueDate', 'breakdown', 'refundStatus'];
