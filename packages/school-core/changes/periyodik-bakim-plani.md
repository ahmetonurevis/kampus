---
etki: minor
---

- Periyodik bakım planı kuralı eklendi (`lib/finance-maintenance-plans.ts`, DOM-FIN-092): türe göre önerilen periyot ve yasal işaret (`MAINTENANCE_PLAN_TYPE_DEFAULTS`), plan açma ve düzeltme (`maintenancePlanSchema`, `updateMaintenancePlanSchema`, `planMaintenancePlan`, `planMaintenancePlanUpdate`), son denetim ve periyottan sonraki denetim günü ile gecikti/yaklaşıyor durumu (`maintenancePlanSchedule`, `addMonthsToDay`; `now` parametreli, 30 gün uyarı), denetim kaydı ve iptali (`maintenanceInspectionSchema`, `planMaintenanceInspection`, `planMaintenanceInspectionCancel`), uygunsuz denetimden arıza talebi taslağı (`maintenanceRequestFromInspection`) ve plan CSV'si (`maintenancePlansCsv`).
