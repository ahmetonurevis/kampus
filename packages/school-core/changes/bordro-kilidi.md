---
etki: minor
---

- Bordro onayı ve dönem kilidi kuralı eklendi (`lib/finance-payroll-periods.ts`, DOM-FIN-108, ON-200): ay onayı, gerekçeli yeniden açma, onay anı girdi özeti ve damga kaynağı (`payrollInputSummary`), genel kilit denetimi (`assertPayrollDaysUnlocked`) ile ücret tanımı ve bordro parametresi yazmalarının etki aralıkları, kilitli ayın farkını sonraki ilk açık aya aktaran düzeltme kaydı (`planPayrollAdjustment`, `payrollAdjustmentTargetMonth`).
