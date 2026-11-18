---
etki: minor
---

- SGK bildirge hazırlık listesi (DOM-FIN-107; ON-203): `lib/finance-sgk-preparation.ts`. Ayın personel listesi `sgkPreparationList` (ana ücret zincirinden ya da elle giriş/çıkış günü, prim günü, eksik gün ve birleşik neden kodu, gün oranlı taban/tavanla SGK matrahı tahmini, uyarılar), toplamlar `sgkPreparationTotals`, bordro parametresinden taban/tavan `sgkParametersFrom`, CSV `sgkPreparationCsv`.
- Elle satır şemaları `sgkMissingDayInputSchema`, `sgkEmploymentDatesInputSchema` ve kuralları `planSgkMissingDays`, `planSgkEmploymentDates`; eksik gün nedeni kodları `SGK_MISSING_DAY_REASONS` (doğrulanmalı, M-63).
