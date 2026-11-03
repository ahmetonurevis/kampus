---
etki: minor
---

- Kur sonu kararından üst kur çıktısı eklendi: `cefr/progression.ts` `progressionNextStep` kaydın geçerli kararı onaylı `geçti` ise kararın kimliğini, kurun sonraki kurunu (DOM-DIL-007) ve sonraki seviyeyi verir; bekleyen, reddedilen, düzeltilmiş, `tekrar` ve `devamsızlıktan tamamlamadı` kararında `null` döner (DOM-DIL-070, IST-062).
- Kur sonu değerlendirme ve geçiş kararı API'si eklendi (OG-086; IST-062, DOM-DIL-013, 060, 070): `POST /api/v1/course-assessments` kur içi ölçmeyi, `POST /api/v1/progression-decisions` grubun öğretmeninin önerisini, `/:decisionId/approve|reject` akademik koordinatörün onayını ya da gerekçeli reddini yazar; `GET /api/v1/groups/:groupId/progression` grubun kur sonu tablosunu, `GET /api/v1/students/:studentId/progression-decisions` kursiyerin kararlarını verir (öğrenci ve veli yalnız onaylı kararı gerekçesiz görür). Ders saati yoklaması yazma ucu olmadığından devam belli değilse karar 409 `attendance_pending` olur.
