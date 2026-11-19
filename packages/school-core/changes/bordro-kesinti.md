---
etki: minor
---

- Bordro girdi satırlarına avans, icra ve BES kesintileri eklendi (`payrollExportLines` `deductions` girdisi, DOM-FIN-105, K-392): personel başına `monthlyDeductions` net ücret ve matrah olmadan çalışır; avans taksiti tutarıyla, icra net ücret oranı ve kalan alacak üst sınırıyla, BES katkı oranı ve matrahıyla `deduction` yönünde satır olur. Sırada bekleyen, alacağı biten icra ve ara verilen BES satır vermez.
- Aya aktarılan bordro düzeltmeleri (DOM-FIN-108) hedef ayın satırıdır (`adjustments` girdisi, K-393): artı fark kazanç, eksi fark kesinti yönünde, tutar mutlak; kaynak ay ayrı alandadır.
- Satır `kind` (`rate`, `lesson_hours`, `deduction`, `adjustment`) ve kesinti/düzeltme alanları (`deductionKind`, `deductionOrder`, `rateBasisPoints`, `deductionBase`, `capCents`, `installmentNo`, `installmentCount`, `adjustmentItem`, `sourceMonth`) taşır; `component` ve `rateType` kesinti ve düzeltmede `null`. Birim `once` (tek sefer) ve uyarılar `deduction_on_net`, `deduction_on_pension_base`, `prior_month_adjustment` eklendi. `payrollItemLabel` bütün satır türlerini adlandırır.
- Genel dosyanın sonuna altı sütun eklendi (Kesinti türü kodu, Kesinti sırası, Oran (%), Matrah, Üst sınır (₺), Ait olduğu ay); önceki sütunların yeri değişmedi, şablon bu sütunları da seçebilir.
- Avans, icra ve BES yazmalarının dönem kilidi aralıkları (`deductionMonthsRange`, `advanceLockRange`, `fromDayLockRange`, `pensionPauseLockRange`; DOM-FIN-101, K-394) eklendi.
