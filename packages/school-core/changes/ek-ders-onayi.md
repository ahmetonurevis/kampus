---
etki: minor
---

- Ek ders çizelgesi onayı kuralı eklendi (`lib/finance-lesson-hour-approvals.ts`, DOM-FIN-120): ayın çizelgesi taslak → öğretmen kontrolü → müdür onayı (kilitli) durumlarından geçer; onaylı ay gerekçeyle yeniden açılıp taslağa döner (`planLessonSheetSubmit`, `planLessonConfirmation`, `planLessonSheetApproval`, `planLessonSheetReopen`). Öğretmen teyidi ya da gerekçeli itirazı öğretmen adına kanalıyla işlenir; teyit personelin o anki saat kayıtlarının parmak izine bağlıdır, kayıt değişince yeniden alınır (`lessonEntriesFingerprint`, `staffFingerprints`, `lessonTeacherStates`). Müdür onaylı ayda saat yazılmaz (`assertLessonHoursWritable`, 409 `lesson_hours_locked`); bordroya yalnız onaylı saatler girer (`lessonHoursForPayroll`).
- Bordro aktarımı (`payrollExportLines`) `lessonHoursApproved` girdisi alır: onaysız ayın ek ders satırı `lesson_hours_pending` uyarısıyla tutarsız döner ve toplama girmez (K-411). Girdi verilmezse onaylı sayılır.
