---
etki: minor
---

- Demirbaş amortisman ön hesabı eklendi (`lib/finance-fixed-asset-depreciation.ts`, DOM-FIN-088): normal (doğrusal) ve azalan bakiyeler yöntemiyle yıllık tablo (`depreciationSchedule`; alım yılı tam yıl, kuruş farkı son yılda, hurdaya ayırma yılında kalan değer düşer), yılın durumu (`depreciationForYear`), kurum ve kategori raporu (`depreciationReport`) ve CSV (`depreciationReportCsv`). Yönetim raporudur, defter kaydı üretmez.
- Demirbaş kaydına faydalı ömür (`usefulLifeYears`, 1–50 yıl; boşsa kategori önerisi `DEFAULT_USEFUL_LIFE`) ve yöntem (`depreciationMethod`) alanları eklendi (`lib/finance-fixed-assets.ts`, `fixedAssetDraft`). `FixedAssetDraft.usefulLifeYears` zorunludur.
