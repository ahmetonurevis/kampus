---
etki: minor
---

- Personel sağlık raporu kuralı eklendi (`lib/finance-medical-reports.ts`, DOM-FIN-110, K-363…K-365): yalnız tarih aralığı, sigorta türü (istirahat, iş kazası, meslek hastalığı, analık), isteğe bağlı veren kurum türü ve dosya; tanı ve not alanı yok. Takvim günü sayısı, tek raporda en çok 366 gün, başlangıç en çok 180 gün ileride, aynı personelde çakışma yok, pasif personelde ayrıldığı günden sonra rapor yok (`medicalReportInputSchema`, `planMedicalReport`). İşaret ve dosya değişikliği (`planMedicalReportUpdate`; SGK onayı bildirimi ister) ve gerekçeli iptal (`planMedicalReportCancel`).
- Dönem okuma fonksiyonları: `medicalReportDays` (türe göre gün ve gün listesi; izin hak edişi ve bordro aktarımı okur), `medicalReportDaysInPeriod`, `monthPeriod`, `assertMedicalReportPeriod`, `medicalReportState` ve ekran bilgi notları `MEDICAL_REPORT_NOTES`.
