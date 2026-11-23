---
etki: minor
---

- Paket saat uyarıları eklendi (ON-084; IST-078, IST-114; DOM-FIN-058, DOM-DIL-051; K-248, K-249): `lib/finance-package-alerts.ts` (`packageSaleAlerts`, `packageAlertNotices`, `packageLowBalanceHours`). Kullanımı başlamış satışta kalan saat satın alınanın %20'sine (en az 1 saat) inince "saat azaldı", son kullanma 14 gün içindeyse "süre doluyor" uyarısı türer, saklanmaz. Aileye `package_hours_low`, `package_expiring` ve süre dolduktan sonraki 7 gün içinde bir kez `package_expired` bildirimi gider (`PACKAGE_NOTIFICATION_TYPES`; yalnız satış kimliği, ayrıntısız başlık).
- Web paket satış listesinde "Saat azaldı" ve "Süre doluyor" rozetleri ile "Uyarı" süzgeci, veli ve öğrencinin "Satın alınan paketler" bölümünde azalan saat ve yaklaşan son kullanma notu eklendi.
