---
etki: minor
---

- Revir ve ilaç onayı kuralı eklendi (`lib/finance-infirmary.ts`, DOM-FIN-151, ON-101, IST-102). Revir ziyareti: öğrenci, geliş anı (gelecekte ve 7 günden eski olamaz), isteğe bağlı gönderen personel, şikâyet, yapılanlar, not ve aynı öğrencinin kaza tutanağına isteğe bağlı bağ (`infirmaryVisitInputSchema`, `planInfirmaryVisit`); öğrencinin tek açık ziyareti olur; açık ziyaret düzeltilir (`planInfirmaryVisitUpdate`), dönüş anı ve sonuçla kapanır ve sonra değişmez (`planInfirmaryDischarge`; K-508).
- Veli ilaç onayı: ilaç adı, doz, doz saatleri, dönem (en çok 90 gün) ve not (`medicationConsentInputSchema`, `planMedicationConsent`); okul onaylar ya da gerekçeyle reddeder (`assertConsentDecision`), veli geri çeker (`assertConsentWithdrawable`). Uygulama yalnız onaylı talepte, dönem içinde, onaydaki saat ve dozla; aynı günün aynı doz saati yinelenmez (`planMedicationAdministration`, `medicationScheduleSlots`; K-509).
- Öğretmen yalnız revirde / döndü durumunu görür (`visitPresence`; K-510).
