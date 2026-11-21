---
etki: minor
---

- Günlük ilaç çizelgesi kuralı eklendi (`lib/finance-infirmary-schedule.ts`, DOM-FIN-152, ON-161, IST-102 genişlemesi). Doz satırının durumu etkin kayıttan ve kurumun gecikme payından (varsayılan 30 dk, 5–180) türetilir: uygulandı, atlandı, gecikti, bekliyor (`doseState`); geciken dozlar üstte (`sortDoseChart`); Europe/Istanbul günü ve saati UTC anına çevrilir (`istanbulInstant`); gecikme payı ayarı (`medicationSettingsSchema`, `planMedicationSettings`; K-511).
- Doz atlama: gerekçe (öğrenci okulda yok, reddetti, veli iptal etti, diğer; "diğer"de açıklama zorunlu), doz günü bugün ya da dün ve onay dönemi içinde; doz saatinin tek etkin sonucu olur, uygulama varken atlama ve atlama varken uygulama 409 (`medicationDoseSkipSchema`, `planDoseSkip`, `resolveDoseSlots`, `assertDoseSlotOpen`; K-512).
- Uygulama ve atlama düzeltmesi: kayıt silinmez, yönetici gerekçeli iptal ya da düzeltme ekler; etkin değer düzeltmelerin sırayla uygulanmasıdır, iptal edilmiş kayıt düzeltilmez, iptalden sonra doz saati yeniden sonuçlanır (`administrationCorrectionSchema`, `skipCorrectionSchema`, `planAdministrationCorrection`, `planSkipCorrection`, `effectiveAdministration`, `effectiveSkip`; K-513).
- Velinin doz geçmişi aralığı (varsayılan son 30 gün, en çok 92 gün; `guardianDoseRange`).
