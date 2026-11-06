---
etki: minor
---

- `POST /api/v1/students/:studentId/withdrawal-quote` ve `/withdraw` bütün yürürlükteki sözleşmeleri (paket satışı dahil) hesaba alır (K-06, DOM-FIN-040, ON-296): döküme sözleşme başına `breakdown.contracts` eklendi, üst tutarlar toplamdır, tek sözleşmeli öğrencide sonuç değişmedi. Migration yok: `contract_id` en yeni sözleşmedir, öteki kimlikler dökümdedir. Ayrılış kalan paket saatini aynı transaction'da iade hareketi yazar (`lesson_package_hour_entries`, DOM-DIL-051). `pay-refund` hesaba giren sözleşmelerden herhangi birinin ödeyicisini kabul eder. OpenAPI ve `api-client` şeması yeniden üretildi.
- K-12: `withdrawal-quote` yanıtına `payersDiffer` ve `payers` (ad, tür; iletişim yok) eklendi. `withdraw` gövdesine `payerDecision` (`payer`, `reason` ≤ 500) eklendi; ödeyiciler farklı ve iade varken karar yoksa 422 `withdrawal_payer_decision_required`, hesap dışı ödeyicide 422 `withdrawal_payer_invalid`, hiçbir kayıt yazılmaz. `pay-refund` yalnız seçilen ödeyiciyi kabul eder. Gerekçe log, denetim, komut yanıtı ve idempotency kaydına girmez; `payerDecision` log maskesine eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.
- K-13: `GET /api/v1/withdrawals` ve `GET /api/v1/withdrawals/:withdrawalId` karar gerekçesini (`breakdown.payerDecision.reason`) yalnız `yonetici` rolüne döndürür; `onburo` yanıtında alan yoktur, ödeyici türü kalır.
