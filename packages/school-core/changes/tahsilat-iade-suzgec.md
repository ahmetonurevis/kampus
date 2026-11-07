---
etki: patch
---

- API: `GET /api/v1/payments` `dateFrom`/`dateTo` ile ödeme gününü (Europe/Istanbul, uçlar dahil) süzer, ters aralık 400; `GET /api/v1/withdrawals` `q` ile öğrenci adında arar (ON-118).
- Web: Tahsilat geçmişine ödeme günü aralığı, Ayrılış ve iade listesine arama ve iade durumu süzgeci eklendi; süzgeçler sunucuda çalışır.
