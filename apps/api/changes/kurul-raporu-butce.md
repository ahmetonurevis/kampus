---
etki: minor
---

`GET /api/v1/finance/board-report` isteğe bağlı `budgetPeriodId` parametresi aldı; yanıta `budgetPeriods`, `budgetPeriod`, `budget` (bütçe–gerçekleşen özeti), `costs` (kampüs konsolide ve öğrenci başı maliyet) ve `forecast` (gelecek yıl gelir tahmini, 12 aylık nakit akışı) eklendi (ON-329, DOM-FIN-064). Uyan bütçe dönemi yoksa `budgetPeriod`, `budget` ve `costs` `null`; kurumda olmayan dönem 422 `board_report_budget_period_not_found`. Bölümler kendi uçlarının servisleriyle hesaplanır. Migration yok.
