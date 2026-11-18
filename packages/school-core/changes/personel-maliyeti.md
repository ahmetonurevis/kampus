---
etki: minor
---

- Personel maliyeti kuralı eklendi (DOM-FIN-104, ON-204). `lib/finance-staff-costs.ts`: personelin maliyet merkezine ay başından yürürlüğe giren, yüzde paylı ataması (`staffCostAllocationInputSchema`, `staffCostAllocationCancelSchema`, `planStaffCostAllocation`, `allocationInMonth`, `allocationEndMonth`), ay yardımcıları (`staffCostMonthSchema`, `monthsBetween`, `monthLabel`, `monthRangeLabel`, `daysInMonth`, `staffCostRangeIssue`) ve rol (`STAFF_COST_ROLES`, yalnız yönetici). `lib/finance-staff-cost-report.ts`: tahmini işveren maliyeti (gün oranlı brüt, indirimli SGK ve işsizlik işveren payı SGK tavanına kadar, yan haklar; `staffMonthCost`, `splitStaffCost`, `staffCostParameters`), merkez kırılımlı rapor ve küçük grup bastırması (`staffCostReport`), notlar (`staffCostNotes`) ve CSV (`staffCostCsv`).
