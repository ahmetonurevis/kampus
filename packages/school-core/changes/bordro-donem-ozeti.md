---
etki: minor
---

- Bordro dönemi kuralına (`lib/finance-payroll-periods.ts`, DOM-FIN-108) onay öncesi durum eklendi (K-425): `payrollPeriodChecks` ek ders çizelgesi durumunu (`none`, `draft`, `teacher_review`, `approved`), kayıtlı bordro hesabının durumunu (`none`, `current`, `stale`) ve kesinti özetini birleştirir; onay bekleyen ek ders engel (`payroll_lesson_hours_pending`), hesabın olmaması ya da güncel olmaması uyarıdır. Etiketler ve mesajlar `PAYROLL_LESSON_SHEET_CHECK_LABELS`, `PAYROLL_RUN_CHECK_LABELS`, `PAYROLL_CHECK_MESSAGES`; kayıtlı satır karşılaştırması `payrollRunRowsMatch`.
- `payrollInputSummary` isteğe bağlı altıncı `extras` girdisi alır (K-426): ayın kesinti satırları ve kayıtlı hesabın kimliği ile revizyonu damga kaynağına girer; ikisi de yoksa damga kaynağı eskisiyle aynıdır.
- Kesinti kuralına (`lib/finance-staff-deductions.ts`) `payrollMonthDeductionSummary` eklendi: ayın avans, icra ve BES satır sayısı, avans taksiti toplamı ve damga satırları.
