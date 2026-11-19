---
etki: minor
---

- Bordro ön hesabı eklendi (DOM-FIN-115; ON-198, ON-193 kararı, ADR 0011): `lib/finance-payroll-calc.ts`. Personel × ay hesabı `payrollCalcRow` (gün oranlı brüt, ek ders, nakdi/ayni yan hak, düzeltme kayıtları, SGK taban/tavan, işçi payları, kümülatif gelir vergisi, asgari ücret GV ve DV istisnası, net, ON-199 kesintileri, ödenecek net, işveren maliyeti), ayın listesi `payrollCalculation`, toplamlar `payrollCalcTotals`, CSV `payrollCalculationCsv`.
- Netten brüte ters hesap `grossForNet` (en küçük kuruş brüt, K-389); dilim vergisi `incomeTaxUnits`, `monthlyIncomeTax` (tek yuvarlama, K-390); ayın seti ve asgari ücret kümülatif matrahı `payrollMonthParameters` (K-388).
- Kayıt ve devir kuralları `payrollRunSaveSchema`, `planPayrollRunSave`, `payrollTaxCarryoverInputSchema`, `planPayrollTaxCarryover` (K-391).
- SGK hazırlık listesinin prim günü mantığı ortak fonksiyona çekildi: `sgkWorkDays`, `sgkProrate` (davranış değişmedi).
