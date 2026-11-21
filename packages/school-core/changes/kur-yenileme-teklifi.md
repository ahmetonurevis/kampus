---
etki: minor
---

- Kur yenileme ve üst kur teklif listesi eklendi (IST-088, ON-082; DOM-DIL-070, DOM-DIL-071, DOM-DIL-050, DOM-FIN-020): `lib/renewal-course-offer-list.ts` `courseOfferRows`. Son kurunun geçerli kur sonu kararı onaylı, etkin kursiyerler için satır üretir; karar ON-295'in `renewalCourseOffer` işlevinden okunur. Geçti kararında teklif zincirdeki sonraki kura ya da üst seviyeye, tekrar ve devamsızlık kararında aynı kura açılır; üst seviye yoksa satır `no_next_level` olur. Teklife uyan etkin paketlerin kurum tarifesinden indirimsiz fiyatı (`options`) ve teklif açılamıyorsa nedeni (`problem`: `tariff_not_published`, `course_offer_package_missing`, `package_course_inactive`, `tariff_tuition_missing`, `package_above_tariff`) döner; karar onayından sonraki satış `saleId` ile teklifi kapatır. Satır kararın gerekçesini ve dayanağını taşımaz.
- `lib/finance-packages.ts` `packageTariffPrice`: paketin indirimsiz tarife fiyatı satıştan ayrıldı; satış (`quotePackageSale`, `sellPackage`) aynı kuralı çalıştırır, davranışı değişmedi.
