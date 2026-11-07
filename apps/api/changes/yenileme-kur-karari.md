---
etki: minor
---

`POST /api/v1/finance/renewals/quote` yanıtına `courseOffer` eklendi (iş isteği #30; DOM-DIL-070): dil okulunda son kurun kur sonu kararı dayanağıdır, onaysız karar önizlemeyi engellemez, uyarıdır. `POST /api/v1/finance/renewals` dil okulunda onaylı karar olmadan 422 `course_decision_pending`, `course_decision_missing` ya da `course_next_level_missing` döner; yenileme ayrıntısı ve listesi `pricing.courseOffer`ı taşır. Okulda `courseOffer` `null`. Yenileme uçları dil okulunda hâlâ kapalıdır (`renewal` modülü yalnız okulda, DOM-YTK-012).
