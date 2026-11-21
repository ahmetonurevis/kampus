---
etki: minor
---

- Acil durum özeti kuralı eklendi (`lib/finance-emergency-summaries.ts`, DOM-FIN-155, ON-165). Yönetici öğrencinin acil eylem metnini (10–500 karakter) yazar ve onaylar; onaydan önce görünmez, yayındaki metnin düzeltmesi onaylanana kadar eski metin görünür (`planEmergencySummaryCreate`, `planEmergencySummaryUpdate`, `planEmergencySummaryApproval`, `emergencySummaryState`). Sağlık profili onaydan sonra değişirse özet gözden geçirilmeli işaretlenir ve metin değişmeden yeniden onaylanabilir (`emergencySummaryNeedsReview`; K-520).
- Özeti yönetici ve ön büro bütün sınıflarda, öğretmen sınıf öğretmeni olduğu ve derse girdiği sınıflarda görür; veli ve öğrenci görmez (`emergencyViewerClasses`, `assertEmergencyClassVisible`; K-521).
- Uyarı işaretleri (alerji, kronik durum, düzenli ilaç) profilden ad ve tanı olmadan türetilir (`emergencyAlertFlags`); acil iletişim servis listesi kuralıyla en çok iki kişi, telefon maskeli; tam telefon sıradaki kişi için ayrı açılır (`emergencyContacts`, `emergencyContactPhone`; K-501, K-522).
- Kart okumasının varsayılan erişim gerekçesi `emergency` olarak eklendi (`EMERGENCY_CARD_DEFAULT_REASON`; DOM-FIN-156); sağlık erişim günlüğüne acil durum özeti eylemlerinin etiketleri eklendi (`HEALTH_ACCESS_ACTION_LABELS`).
