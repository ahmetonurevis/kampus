---
etki: minor
---

Tahsilat listesi ödeme yöntemine göre süzülür: `GET /api/v1/payments?method=<yöntem>` (ON-036; DOM-FIN-030). Değer `Banka havalesi`, `Nakit`, `Kredi kartı` ya da `Senet`; başka değer 400. `q` ve `mebbis` ile birlikte kullanılır, veli ve öğrenci kapsamı değişmez.
