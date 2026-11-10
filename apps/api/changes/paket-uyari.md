---
etki: minor
---

Paket saat uyarıları (ON-084; IST-078, DOM-FIN-058, K-248, K-249): `GET /api/v1/finance/package-sales` ve paket satış yanıtları `alerts` (`low_balance`, `expiring`) taşır, liste `alert` sorgusuyla süzülür; `GET /api/v1/finance/students/:studentId/package-balance` satırlarında da `alerts` vardır. Sabah taraması (`jobs/finance-package-alerts.ts`, `packages.alert`, 09:30 Europe/Istanbul) dil okulunda aileye `package_hours_low`, `package_expiring`, `package_expired` bildirimi yazar; zamanlama `jobs/registry.ts` satırını bekler. Migration yok.
