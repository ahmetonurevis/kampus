---
etki: minor
---

- Yönetim kurulu raporuna bütçe, maliyet ve tahmin bölümleri eklendi (`lib/finance-board-report-sections.ts`, DOM-FIN-064, ON-329): rapor dönemine uyan bütçe dönemi seçimi (`boardBudgetPeriod`, K-113), bütçe–gerçekleşen özeti ve en çok sapan kalemler (`boardBudgetSummary`, K-114), kampüs konsolide özet ve öğrenci başı maliyet (`boardCostSummary`, K-116; 1–4 kişilik kampüsün sayı ve tutarları `suppressSmallGroups` ile ikincil gizlemeyle gizlenir) ile gelecek yıl gelir tahmini ve 12 aylık nakit akışı özeti (`boardForecastSummary`, K-115). Bölümler var olan hesapların sonucundan türetilir; kişi verisi taşımaz.
- `boardReportQuerySchema` isteğe bağlı `budgetPeriodId` alır.
