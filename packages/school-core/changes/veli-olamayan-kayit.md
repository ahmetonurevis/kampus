---
etki: minor
---

- `parent_not_guardian` velayet bağlarını da denetler (ON-105; DOM-ILT-070, DOM-ILT-071, DOM-ILT-074): `EnrollmentContext.guardianBonds` (seçilen velinin etkin bağları) bir öğrencide iletişim kısıtlı ya da velayetsiz bağ taşıyorsa `enrollProspectWithTariff` 422 `parent_not_guardian` (`path: ['guardian']`) verir, State değişmez. `findParentMatches` `bonds` seçeneğiyle böyle veliyi önermez. Yeni: `hasNonCustodialBond`, `ParentBond`.
