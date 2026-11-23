---
etki: minor
---

- Personel izin türleri ve yıllık izin hak edişi kuralı eklendi (`lib/finance-staff-leave.ts`, DOM-FIN-109): platform varsayılan türleri (yıllık, 4857 Ek md. 2 mazeret izinleri, ücretsiz, rapor, diğer) kurumda ad, ücretli mi, yıllık izinden düşer mi, varsayılan gün ve etkinlikle ayarlanır; yasanın sabitlediği alanlar kilitlidir, kurum ek tür açabilir (`effectiveLeaveTypes`, `planLeaveTypeCreate`, `planLeaveTypeUpdate`).
- Hak ediş saf fonksiyonu `leaveEntitlement`: kıdem başlangıcının her yıl dönümünde 1–5 yıl 14, 6–14 yıl 20, 15 yıl ve üstü 26 gün; hak ediş gününde 18 yaşından küçük ya da 50 yaş ve üstü en az 20 gün; açılış devri, devreden bakiye, bu yılın hakkı, kullanılan, planlanan ve kalan. İzin profili (`planLeaveProfile`, `planLeaveProfileUpdate`) ve elle kullanılmış izin kaydı (`planLeaveRecord`; rapor elle yazılmaz, çakışma ve aralık denetimi).
