---
etki: minor
---

- Kesin kayıt veli–öğrenci bağını döndürür (ON-010; DOM-ILT-070, DOM-ILT-074): `enrollProspectWithTariff` sonucuna `guardianBond` eklendi (`parentId`, `relationship`, `isPayer`); veli varsa sözleşmenin ödeyicisidir, yetişkin kursiyerin kendisinde `null`. Yakınlık yeni velide formdaki değer, mevcut velide kayıtlı değerdir; tanınmıyorsa `other`.
