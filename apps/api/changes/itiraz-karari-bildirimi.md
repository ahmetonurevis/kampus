---
etki: minor
---

İtiraz kararında öğrenci ve veliye bildirim (OG-021, IST-065, IST-048; `docs/domain/beceri-gelisimi.md` DOM-BEC-025, DOM-BEC-045; DOM-ILT-023). Core tarafı `packages/school-core/changes/itiraz-karari-bildirimi.md`'dedir.

- `POST /api/v1/task-submissions/:submissionId/appeals/:appealId/decision` kararı kabulde de retle de aynı işlemde öğrenciye ve 18 yaş altında veliye `appeal_decided` bildirimi yazar; karar ya da yeni son puan yazılamazsa bildirim de yoktur. İtiraz başına tek bildirim (`dedupeKey` itiraz kimliği). Bildirim yalnız teslim kimliğini taşır; sonuç, gerekçe ve puan teslim ayrıntısından okunur. İletişim ya da öğrenme modülü kapalıysa yazılmaz.
- Geri bildirimi öğrenciye açan yazma yolları tarandı: ilk puan, uyuşan ikinci puan ve uyuşmazlıkta koordinatör son puanı zaten `feedback_released` yazıyordu (`writeScore`); itiraz kararı geri bildirimi yeniden açmaz. `feedback_released` artık sürüm kimliğiyle `dedupeKey` taşır (aynı sürüm için ikinci bildirim yazılmaz).
- `GET /api/v1/notifications` yanıtındaki `kind` listesine `appeal_decided` eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.
