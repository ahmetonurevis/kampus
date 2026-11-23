---
etki: minor
---

- Dil okulu yenileme teklifinin kur sonu kararı dayanağı eklendi (iş isteği #30; DOM-DIL-070, DOM-DIL-007): `lib/renewal-course-offer.ts` `renewalCourseOffer` öğrencinin son kurundaki (iptal edilmemiş, en geç başlayan grup) geçerli kararı OG-086'nın `progressionNextStep` işleviyle okur. `geçti` teklifi sonraki kura ya da üst seviyeye, `tekrar` ve `devamsızlıktan tamamlamadı` aynı kura açar. Onay bekleyen karar (düzeltme dahil) `pending`, onaylı karar yok `missing`, üst seviye yok `no_next_level` durumudur. `quoteRenewal` dayanağı `courseOffer` alanında döndürür; `planRenewal` `ready` dışındaki durumda 422 `course_decision_pending`, `course_decision_missing` ya da `course_next_level_missing` ile reddeder ve kayıt değişmez. Plan dayanağı `pricing.courseOffer`ta saklar. Okul kurumunda `courseOffer` `null`, davranış değişmez.
