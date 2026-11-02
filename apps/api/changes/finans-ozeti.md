---
etki: minor
---

Finans özeti ucu eklendi: `GET /api/v1/finance-summary` (ON-012; IST-116, IST-121). Yönetici ve ön büro okur, modül `finance`; dönem isteğe bağlıdır (varsayılan son altı takvim ayı), tek uç 400, ters ya da bir yılı aşan dönem 422. Muhasebe dosyası toplamı için `/finance/summary` değişmedi.
