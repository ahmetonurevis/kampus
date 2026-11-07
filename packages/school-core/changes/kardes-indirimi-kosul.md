---
etki: minor
---

- Kardeş indirimi yalnız aynı eğitim yılında aktif kaydı olan kardeş varsa uygulandı (DOM-FIN-022, K-22; ON-301): `requireSiblingDiscountEligible` (`lib/enrollment.ts`) `academicYear` ve `currentAcademicYear` alanlarını zorunlu ister, ayrılan, mezun, dondurulan ya da o yıla ait yürürlükte sözleşmesi olmayan kardeşi saymaz. Ücret sırası o yılın sözleşmesiyle kurulur; yenilemede çocuğun ücreti ilan değil sözleşmeye yazılacak ücrettir. Ret kodu yine `sibling_discount_ineligible`, ayrı iletiyle. `contract.amend` komutu `academicYear` skalerini okur. Toplu önizlemede öndeki satırın sözleşmesi sonraki satıra görünür.
