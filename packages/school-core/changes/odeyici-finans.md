---
etki: minor
---

- Ödeyici veliye finans okuma kapsamı (ON-291; K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052, DOM-ILT-074): velayeti olmasa da ödeyici veli ödediği öğrencinin faturasını ve sözleşmesini okur (`lib/scope.ts` `ONUR_READ_RULES`: `invoices` `FINANCE_PERSONAL`, `contracts` `ownOrPayerStudent`). API'de bakiye, cari ekstre, tahsilat listesi ve ayrıntısı (dekont) `financeStudentIds(scope)` ile açılır. Yenileme, kayıt geçmişi, aday ve akademik okumalar velayet kapsamında kalır; iletişim kısıtlı veli finans okumaz. Velayetsiz ödeyici finans bildirimini (vade, gecikme, tahsilat) alır; velayetli ödeyici aynı bildirimi bir kez görür.
