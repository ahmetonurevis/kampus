---
etki: patch
---

- Sınıf mevcudu, yoklama, duyuru alıcıları ve izin formu hedefi öğrencinin etkin olup olmadığını `isActive` bayrağından değil türetilmiş kayıt durumundan okur (OG-1008, ON-043; DOM-KAY-026): yeni `lib/student-roster.ts` `studentsWithEffect` `ENROLLMENT_STATUS_EFFECTS` bayrağıyla süzer. Davranış aynıdır (ayrılan ve mezun öğrenci listede, yoklamada ve akademik alıcılarda yoktur). Komut tablosunda `attendance.record`, `class.save`, `announcement.publish`, `permissionForm.create` ve `permissionForm.update` dönem geçişi kayıtlarını (`renewals`) da yükler.
