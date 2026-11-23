---
etki: minor
---

Burs fonu uçları eklendi (ON-259; DOM-FIN-068): `GET/POST /api/v1/finance/scholarship-funds`, `GET …/:fundId/report` (`Accept: text/csv` ile taze oturumlu, denetimli CSV), `POST …/:fundId/donations`, `POST …/:fundId/allocations`, `POST …/:fundId/donations/:donationId/cancel`, `POST …/:fundId/allocations/:allocationId/cancel` (dördü `Idempotency-Key` zorunlu), `POST …/:fundId/close`. Okuma yönetici ve ön büro, yazma yönetici; raporda öğrenci adı yalnız yöneticiye. Migration `0076`: `scholarship_funds`, `scholarship_fund_donations`, `scholarship_fund_allocations`.
