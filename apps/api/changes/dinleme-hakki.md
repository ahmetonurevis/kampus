---
etki: minor
---

Dinleme hakkı sayımı (OG-049; IST-045; DOM-BEC-005; ADR 0003 karar 6).

- Migration `0030_create_attempt_media_plays`: deneme × dosya × sıra tekil, değişmez sayım satırları.
- `GET /api/v1/files/:fileId/url`: öğrencinin süren denemesinde, atamanın içerik sürümüne bağlı `listening_audio` kaydının bağlantısı hakkı deneme × kayıt başına sayar; yanıtta yeni `listening` alanı (`attemptId`, `limit`, `used`, `remaining`, `counted`; diğer durumlarda `null`). Hak bitince 422 `listening_plays_exhausted`; süren deneme yokken teslimi açık görevde 422 `listening_attempt_required`. Son sayımın bağlantısı geçerliyken (5 dk) yeni istek sayılmaz, aynı bitiş anıyla bağlantı döner. Öğretmen, yönetici, veli ve teslim kapandıktan sonraki bağlantı sayılmaz.
- `GET /api/v1/task-attempts/:attemptId` ve deneme yazma yanıtları `listening` özetini döner (`limit`, kayıt başına `used`/`remaining`; sınırsızda `null`).
- `POST /api/v1/task-assignments`: dinleme hakkı core varsayılanına döndü (gönderilmezse 2; 1 veya `null` seçilebilir); 422 `listening_plays_unavailable` kaldırıldı.
- OpenAPI ve api-client şeması yeniden üretildi.
