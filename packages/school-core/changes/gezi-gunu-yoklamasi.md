---
etki: minor
---

- Gezi günü yoklaması ve acil kart kuralı eklendi (`lib/finance-trip-day.ts`, DOM-FIN-154, ON-157). Onaylı gezinin katılımcıları araç/gruplara dağıtılır; grup sorumlusu planın görevlisidir (`tripDayGroupSchema`, `planTripDayGroup`, `planTripDayAssign`; süren turu olan grubun dağıtımı değişmez; K-517).
- Yoklama turu adlandırılmış kontrol noktasında açılır ve öğrenci başına var/yok işaretlenir (`planTripDayCheckStart`, `planTripDayMarks`; aynı işaretin yinelenmesi yazılmaz, çevrimdışı işaret anı 24 saatten eski ve 5 dk'dan ileri olamaz). Eksik varken tur "tamam" yapılamaz (`planTripDayCheckComplete`); herkes işaretliyken gerekçeyle "eksikle devam" denir (`planTripDayCheckProceed`; K-517).
- Acil kart: tam telefon yönetici ve gezi günü grup sorumlusunda (`assertTripDayCardPurpose`); sağlık uyarısı yalnız "alerji / kronik durum / ilaç var" işareti, kısaltılmış acil talimat ve revirde bugün ilaç işaretidir (`tripDayHealthAlert`, `tripDayHealthLabel`; K-518).
- Gezi acil kartı okuması sağlık erişim günlüğüne eklendi (`HEALTH_ACCESS_ACTION_LABELS`: `finance.trip_day.emergency_card`, `finance.trip_day.emergency_card_full`; DOM-FIN-156).
