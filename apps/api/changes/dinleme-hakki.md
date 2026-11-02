---
etki: minor
---

Dinleme hakkı sayım altyapısı (OG-049; IST-045; DOM-BEC-005; ADR 0003 karar 6). Altyapı devrede değildir: core içerik modeli dinleme kaydını atanabilen türlere bağlamaz (`TODO(dinleme-icerik-bagi)`).

- Migration `0030_create_attempt_media_plays`: deneme × dosya × sıra tekil, değişmez sayım satırları.
- `POST /api/v1/task-assignments`: değişmedi; dinleme hakkı gönderilmezse sınırsız, 1 veya 2 için 422 `listening_plays_unavailable`.
- `GET /api/v1/files/:fileId/url`: dinleme kaydının (`listening_audio`) bağlantısı kayıt süresi + 60 sn yaşar (en az 5 dk; süre ölçülmemişse 16 dk). Yanıtta yeni `listening` alanı (`attemptId`, `limit`, `used`, `remaining`, `counted`); hakkı sınırlı süren deneme olmadıkça `null`. Altyapı devreye girince hak bitince 422 `listening_plays_exhausted`, süren deneme yokken teslimi açık görevde 422 `listening_attempt_required`; son sayımın penceresinde yeni istek sayılmaz.
- `GET /api/v1/task-attempts/:attemptId` ve deneme yazma yanıtları `listening` özetini döner (`limit`, kayıt başına `used`/`remaining`); sınırsızda ya da sayacak kayıt yoksa `null`.
- OpenAPI ve api-client şeması yeniden üretildi.
