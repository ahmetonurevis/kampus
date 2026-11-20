---
etki: minor
---

Personel performans raporu kuralları eklendi (DOM-FIN-137; ON-220): `lib/finance-performance-reports.ts` personel × dönem raporunun bölümlerini (dönem sonu değerlendirmesi, öz değerlendirme, ders gözlemleri, gelişim hedefleri, yönetici görüşü; K-466), dönemdeki tamamlanmış gözlem seçimini (`isObservationInPeriodReport`), dönem özetini (genel puan ortalaması, en düşük ve en yüksek, bant dağılımı, gözlem ortalaması; `performanceReportSummary`), kapanan dönemde görüşle kesinleştirmeyi ve personel adına kanallı "okudum" kaydını (K-467) ve görünürlüğü (yönetici her rapor, öğretmen yalnız kendi kesinleşmiş raporu; `canViewPerformanceReport`, K-468) tanımlar. Gelişim hedefleri bölümü döneme bağlı açık, süren ve ulaşılan hedefleri kesinleştirme anındaki durumuyla alır (`developmentGoalStatusAt`, `isGoalInPerformanceReport`; K-468).
