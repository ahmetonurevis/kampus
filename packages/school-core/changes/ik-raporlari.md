---
etki: minor
---

- İK raporları (DOM-FIN-117; ON-192): `lib/finance-hr-reports.ts`. Dönem `hrReportPeriod` (süren dönem bugünde biter, başlamamış dönem 422 `hr_report_period_not_started`), rapor `hrReport`: devir oranı (`turnoverCounts`; çıkış ÷ ((dönem başı + dönem sonu) ÷ 2)) kurum, rol (öğretmen, idari) ve maliyet merkezi kırılımında; kıdem bantları (`seniorityBandOf`, bilinmiyor dahil); izin türüne göre kullanılan gün, personel başına ortalama, kalan yıllık izin bakiyesi ve yalnız toplam rapor günü. 1–4 kişilik kırılım `suppressSmallGroups` (K-77) ile gizlenir (K-401).
- Gösterim ve dosya: `hrReportNotes`, `hrReportCsv`, `hrReportFilename`, `hrPeriodLabel`, `hrRateText`, `hrDecimalText`, `hrHiddenText`; rol `FINANCE_HR_REPORT_ROLES` (yalnız yönetici).
