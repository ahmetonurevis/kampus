---
etki: minor
---

- Gezi planı ve onay dosyası kuralları eklendi (ON-155, DOM-FIN-111; K-366…K-368): `lib/finance-trip-plans.ts` plan şeması (`tripPlanSchema`, `updateTripPlanSchema`; güzergâh, görevliler, ulaşım, risk değerlendirmesi, acil iletişim, isteğe bağlı ücretli etkinlik bağı), plan bütünlüğü (`checkTripPlan`), düzeltme ve yeniden onay (`planTripPlanUpdate`), onaya gönderme (`planTripPlanSubmit`), onay (`planTripPlanApprove`), tamamlama (`planTripPlanComplete`), iptal (`planTripPlanCancel`), millî eğitim bildirimi işareti (`planTripPlanNotice`), görevli oranı uyarısı (`tripStaffRatio`, `tripStaffRatioMessage`), rol işlemleri (`tripPlanActions`), plan numarası ve plaka biçimi (`tripPlanNumber`, `normalizeTripPlate`, `tripPlateLabel`).
