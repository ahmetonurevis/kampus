---
etki: minor
---

- Gelir senaryo analizi eklendi (ON-248; K24; DOM-FIN-067): `lib/finance-scenarios.ts`. `financeScenarioComparison` gelir tahmininin üzerine en çok dört senaryoda yeni kayıt ve yenileme öğrenci sayısı (yüzde ya da adet), fiyat ve indirim-burs oranı değişimini uygular, temel ile farkı verir; `scenarioCashFlow` gelir farkını eğitim yılının kalan aylarına yayarak nakit akışına etkisini hesaplar. Girdi şeması `financeScenarioRequestSchema`, CSV üreticisi `financeScenarioCsv`.
- Gelir tahmininin huni kalemi beklenen kayıt sayısını da verir: `pipeline.expectedEnrollments` (`lib/finance-forecast.ts`).
