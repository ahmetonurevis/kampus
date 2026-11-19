---
etki: minor
---

- Kadro planı ve açık pozisyon kuralı eklendi (`lib/finance-staffing-plans.ts`, DOM-FIN-126): branş başına ihtiyaç, program önerisi, tam zamanlı kapasite (saatlik ücretli hariç, çok branşlıda norm bölünür), açık, açık/ilandaki pozisyon düşümü, önerilen saat ve tam zamanlı eşdeğeri (`staffingRows`, `staffingTotals`); programdan haftalık ders saati önerisi (`scheduleHoursBySubject`, `staffingWeek`).
- Plan şeması `staffingPlanInputSchema` (norm 1–40, branş saati 0–2000, aynı branş bir kez) ve `planStaffingPlan` (değişiklik yoksa 422 `staffing_plan_unchanged`); pozisyon şemaları ve durum geçişleri `planStaffingPositionUpdate` (açık ↔ ilanda → dolduruldu/iptal; son durumlar 422 `staffing_position_closed`).
