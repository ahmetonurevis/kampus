---
etki: minor
---

Ders videosu izleme ilerlemesi (OG-252; IST-041; `docs/domain/kaynak-platformu.md` DOM-KYN-005).

- Yeni uç eklendi: `POST /api/v1/videos/:videoId/progress` (gövde `{ positionSeconds, durationSeconds }`, saniye). Yalnız öğrenci; sunucu yüzdeyi hesaplar ve geri gitmez, son konum her istekte güncellenir. Kapsam dışı düzey, olmayan ve başka kurumun videosu 404, bağlantısız öğrenci 403 `student_scope_denied`, modül `learning` kapalıysa 403 `module_disabled`, geçersiz gövde 400. Aynı istek tekrarlanınca kayıt değişmez; `Idempotency-Key` isteğe bağlı, `If-Match` 400. Okuma `GET /collections/videoProgress`'tedir.
- İlerleme `records` tabanlıdır (`videoProgress`, anahtar `<öğrenci>:<video>`; migration yok). İşlem öğrencinin kendi kaydı ve sınıfıyla dar yüklenir.
- İşlem çalıştırıcıya `skipAudit` eklendi: 15 sn'de bir yazılan teknik ilerleme kaydı denetim satırı üretmez.
- OpenAPI ve `api-client` şeması yeniden üretildi.
