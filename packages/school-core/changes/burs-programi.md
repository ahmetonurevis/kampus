---
etki: minor
---

- Burs programı eklendi (ON-014; DOM-FIN-021, DOM-FIN-025): `lib/finance-scholarships.ts` (program oluşturma, bildirim ve MEBBİS günü, atama kuralları, burs tutarı). `enrollProspectSchema` isteğe bağlı `scholarshipProgramId` alır; burs netten düşer, indirim tavanına girmez, `ContractTerms.scholarship` olarak sözleşmeye yazılır, tam bursta öğrenim taksiti açılmaz. `enrollProspectWithTariff` sonucuna `scholarshipAward` eklendi. `scholarship.manage` yazma eylemi yalnız `yonetici`dir.
