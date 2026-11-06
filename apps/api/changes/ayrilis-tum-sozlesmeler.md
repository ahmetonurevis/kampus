---
etki: minor
---

- `POST /api/v1/students/:studentId/withdrawal-quote` ve `/withdraw` bütün yürürlükteki sözleşmeleri (paket satışı dahil) hesaba alır (K-06, DOM-FIN-040, ON-296): döküme sözleşme başına `breakdown.contracts` eklendi, üst tutarlar toplamdır, tek sözleşmeli öğrencide sonuç değişmedi. Migration yok: `contract_id` en yeni sözleşmedir, öteki kimlikler dökümdedir. Ayrılış kalan paket saatini aynı transaction'da iade hareketi yazar (`lesson_package_hour_entries`, DOM-DIL-051). `pay-refund` hesaba giren sözleşmelerden herhangi birinin ödeyicisini kabul eder. OpenAPI ve `api-client` şeması yeniden üretildi.
