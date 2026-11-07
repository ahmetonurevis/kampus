---
etki: minor
---

- Görev atamasının erişim kuralı core'a alındı (OG-229; DOM-YTK-028): `skills/assignment-access.ts` `canReadAssignment` (yönetici kurumda; öğretmen atadığını ve kapsamındaki sınıf/grup/öğrenciyi hedefleyeni; öğrenci ve veli kapsamındaki kursiyere hedeflenen arşivsiz atamayı; ön büro hiçbirini görür), `canManageAssignment` (yalnız yönetici ve atayan öğretmen) ve `canGradeAssignment` (yönetici ve atamayı gören öğretmen). `targetedLearners` ve `teacherReachesTarget` aynı dosyaya taşındı. API ve web aynı fonksiyonları çağırır; davranış değişmedi.
