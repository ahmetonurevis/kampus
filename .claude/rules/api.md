---
paths:
  - 'apps/api/**'
  - 'packages/api-client/**'
---

# API kuralları

Ayrıntı: `docs/muhendislik/api-tasarimi.md`, `docs/muhendislik/kod-yazim.md`. Güvenlik `.claude/rules/guvenlik.md`, veritabanı `.claude/rules/veritabani.md`.

- Fastify 5 + TypeScript (strict), Node 24 tür ayıklamasıyla doğrudan `.ts` çalışır. Uygulama `buildApp(options)` fabrikasıyla kurulur; test ve sunucu aynısını kullanır.
- Katmanlar: `src/routes` (HTTP, şema, kimlik), `src/services` (iş akışı; school-core kurallarını çağırır), `src/db` (Drizzle şeması, kurum kapsamlı depo). Route içinde SQL veya iş kuralı yazılmaz. Servis `request` almaz; `{ db, institutionId, actor, now, log }` bağlamı alır.
- Yollar `/api/v1/<çoğul-kebab-case>`; komut `POST /<kaynak>/:id/<fiil>`; `PUT` yok, `PATCH` kısmi; `DELETE` arşivler.
- Her rota `params`/`querystring`/`body` ve **`response`** şeması taşır (Zod, `school-core/contracts`). Şemada olmayan alan istemciye gitmez.
- Başarı `{ data, meta? }`; hata `{ code, message, issues?, requestId }`. `code` İngilizce snake_case, `message` Türkçe ve teknik ayrıntısız.
- Durumlar: Zod 400 (`issues`), kimliksiz 401, rol/kapsam/modül kapalı 403, yok veya başka kurum 404, sürüm/benzersizlik 409, `DomainError` kind `rule` 422, hız sınırı 429, beklenmeyen 500 (ayrıntı yalnız logda). Düz `Error` kullanıcı hatası sayılmaz.
- Liste: `page` + `pageSize` (≤ 100) + `meta.total`; büyüyen akışlarda `cursor`. Filtre/sıralama alanları şemada beyaz liste; bilinmeyen parametre 400. CSV `Accept: text/csv` ile, formül enjeksiyonuna karşı kaçışlı.
- Yazma tek veritabanı işleminde; başarısızlıkta hiçbir kayıt değişmez. Gövdedeki `version` ile iyimser kilit.
- Ödeme, iade, taksit/sözleşme oluşturma, toplu içe aktarma ve toplu gönderimde `Idempotency-Key` zorunlu; anahtar işlemle aynı transaction'da saklanır.
- Tarih ISO 8601 UTC (`…At`) veya `YYYY-MM-DD` (`…Date`); para tamsayı kuruş. Sunucu biçimlenmiş metin döndürmez.
- Log pino ile: `request.log`, gövde ve kişisel veri yok, `console.*` yok. Ortam değişkeni yalnız `src/config.ts`'te okunur.
- OpenAPI şemalardan üretilir; `apps/api/openapi.json` uç değişikliğiyle aynı committe güncellenir.
- Her uç için test: 401, 403, başka kurum 404, 400 ve kayıt değişmemesi, başarı ve kalıcılık, mükerrer işlem. `app.inject` + PGlite.
- `api-client` uçların tek tipli istemcisidir; uç eklenince istemci ve tipi aynı committe güncellenir. Hata zarfı `ApiError`'a çevrilir.
