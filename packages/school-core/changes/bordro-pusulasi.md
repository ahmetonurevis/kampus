---
etki: minor
---

- Ücret hesap pusulası verisi eklendi (DOM-FIN-119; ON-201, K-406…K-408): `lib/finance-payroll-payslips.ts`. Kayıtlı bordro satırından personele verilen alt küme `payrollPayslip` (işveren payları, maliyet, sağlık raporu günü, uyarılar ve kesinti kaynağı düşer; bu ay dahil kümülatif GV matrahı eklenir), yasal kesinti toplamı `payslipStatutoryCents`, kesinti etiketleri `payslipDeductionLabels`, sorgu şeması `payrollPayslipQuerySchema`, doğrulama notu `PAYROLL_PAYSLIP_NOTE`.
