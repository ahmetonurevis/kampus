---
etki: minor
---

`GET /api/v1/finance/students/:studentId/package-balance` (öğrencinin paket saat bakiyesi; tutar yalnız yönetici ve ön büroya) ve `GET /api/v1/finance/package-report` (yönetici; dönemli satılan, kullanılan, iade edilen, süresi dolan saat ve gelir tanıma dökümü, sayfalı; `Accept: text/csv` ile taze oturumlu, 10/dk, denetimli CSV) eklendi (ON-074, IST-114, DOM-FIN-057). Migration yok.
