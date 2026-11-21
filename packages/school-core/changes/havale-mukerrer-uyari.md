---
etki: minor
---

- Olası mükerrer denetimi ters yönde de çalışır (`assertNoStatementDuplicate`, DOM-FIN-069, K-121; ON-332): elle girilen banka havalesi tahsilatında öğrenciye aynı gün aynı tutarda banka ekstresinden onaylanmış etkin tahsilat varsa `bank_match_possible_duplicate` (409); `recordPaymentSchema` isteğe bağlı `confirmDuplicate` ile açık onayı alır. Nakit, kart ve senet denetlenmez.
