---
etki: minor
---

- Öğrencinin kayıt durumu ve geçiş olayları eklendi (ON-043; DOM-KAY-026): `lib/enrollment-status.ts` `enrollmentStatus`/`enrollmentStatuses` durumu (`active`, `withdrawn`, `graduated`) saklamadan aktiflik bayrağından ve uygulanmış mezuniyetten türetir; `ENROLLMENT_STATUS_EFFECTS` sınıf listesi, yoklama, akademik ve finans bildirimi sonuçlarını verir; `enrollmentEvents` kesin kayıt, yenileme, dönem geçişi, mezuniyet ve ayrılış olaylarını var olan kayıtlardan (`renewals`, `student_withdrawals`) eskiden yeniye sıralar. Mevcut işlemlerin davranışı değişmedi.
