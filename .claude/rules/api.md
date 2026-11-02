---
paths:
  - 'apps/api/**'
  - 'packages/api-client/**'
---

# API kuralları

Ayrıntı: `docs/muhendislik/api-tasarimi.md`, `docs/muhendislik/kod-yazim.md`. Güvenlik `.claude/rules/guvenlik.md`, veritabanı `.claude/rules/veritabani.md`, paketler `.claude/rules/bagimliliklar.md`.

- Fastify 5 + TypeScript (strict), Node 24 tür ayıklamasıyla doğrudan `.ts` çalışır. Uygulama `buildApp(options)` fabrikasıyla kurulur; test ve sunucu aynısını kullanır. Rota kaydı: platform uçları `routes/platform-routes.ts`, kayıt ve finans uçları `app.ts`'teki Onur bloğu; kayıt ve içe aktarma sırası OpenAPI sırasını belirler, yeni platform ucu `PLATFORM_LATE_ROUTES` sonuna eklenir.
- Hazır paket önce (ADR 0002): resmi `@fastify/*` eklentileri (helmet, cors, cookie, rate-limit, multipart, swagger), Better Auth, Drizzle, `pg-boss`, `nodemailer`; aynı işi yapan ara katman elle yazılmaz.
- Katmanlar: `src/routes` (HTTP, şema, kimlik), `src/services` (iş akışı; school-core kurallarını çağırır), `src/db` (Drizzle şeması, kurum kapsamlı depo), `src/storage` (dosya deposu arayüzü ve sürücüleri; ADR 0003), `src/jobs` (pg-boss). Route içinde SQL veya iş kuralı yazılmaz. Servis `request` almaz; `{ db, institutionId, actor, now, log }` bağlamı alır.
- Yollar `/api/v1/<çoğul-kebab-case>`; komut `POST /<kaynak>/:id/<fiil>`; `PUT` yok, `PATCH` kısmi; `DELETE` arşivler. `/api/v1/auth/*` Better Auth'undur: zarf kuralları ona uygulanmaz, aynı işi yapan ikinci uç yazılmaz.
- Her rota `params`/`querystring`/`body` ve **`response`** şeması taşır (`fastify-type-provider-zod`). Gövde şeması school-core işlem şemasıdır; yanıt/sorgu şemaları `routes/<alan>.schemas.ts`. Şemada olmayan alan istemciye gitmez.
- Başarı `{ data, meta? }`; hata `{ code, message, issues?, requestId }`. `code` İngilizce snake_case, `message` Türkçe ve teknik ayrıntısız.
- Durumlar: Zod 400 (`issues`), oturumsuz 401, rol/kapsam/modül kapalı/etkin kurum yok/taze oturum gerekli/CSRF 403, yok veya başka kurum 404, sürüm/benzersizlik 409 (23505 kısıt adına göre `src/unique-constraints.ts`; sınıflanmamış kısıt 422 `duplicate_record`), `DomainError` kind `rule` 422, hız sınırı 429, beklenmeyen 500 (ayrıntı yalnız logda). Düz `Error` kullanıcı hatası sayılmaz.
- Liste: `page` + `pageSize` (≤ 100) + `meta.total`; büyüyen akışlarda `cursor`. Filtre/sıralama alanları şemada beyaz liste; bilinmeyen parametre 400. CSV `Accept: text/csv` ile, formül enjeksiyonuna karşı kaçışlı.
- Yazma tek veritabanı işleminde; başarısızlıkta hiçbir kayıt değişmez. Gövdedeki `version` ile iyimser kilit.
- Ödeme, iade, taksit/sözleşme oluşturma, toplu içe aktarma ve toplu gönderimde `Idempotency-Key` zorunlu; anahtar işlemle aynı transaction'da saklanır.
- Tarih ISO 8601 UTC (`…At`) veya `YYYY-MM-DD` (`…Date`); para tamsayı kuruş. Sunucu biçimlenmiş metin döndürmez.
- `pg-boss` işi idempotenttir, yükü yalnız kimlik taşır (`institutionId`, `actorUserId`, kayıt kimliği), aynı servis katmanını çağırır.
- Log pino ile: `request.log`, gövde, çerez ve kişisel veri yok, `console.*` yok. Ortam değişkeni yalnız `src/config.ts`'te okunur.
- OpenAPI (`@fastify/swagger`) şemalardan üretilir. `apps/api/openapi.json` ve `packages/api-client/src/schema.d.ts` (`openapi-typescript`) uç değişikliğiyle aynı committe yeniden üretilir, elle düzenlenmez.
- `api-client` `openapi-fetch` ile çağırır; uç başına elle istemci fonksiyonu yazılmaz. Hata zarfı ince `ApiError` sınıfına çevrilir.
- Her uç için test: 401, 403, başka kurum 404, 400 ve kayıt değişmemesi, başarı ve kalıcılık, mükerrer işlem. `app.inject` + PGlite; oturum Better Auth girişinden.
