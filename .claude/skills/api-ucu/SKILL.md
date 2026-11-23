---
name: api-ucu
description: Kampüs API'sine (apps/api, Fastify + Drizzle + PostgreSQL, Better Auth) yeni uç ekleme kontrol listesi — sözleşme, route ve response şeması, kimlik ve kurum kapsamı, school-core kuralıyla servis, transaction, Idempotency-Key, OpenAPI/istemci yeniden üretimi ve testler. Yeni okuma/yazma ucu eklerken veya bir modülü API'ye taşırken kullan.
argument-hint: <metod ve yol, ör. POST /api/v1/goals/:goalId/approve>
---

# API ucu ekleme

Kurallar `.claude/rules/api.md`, ayrıntı `docs/muhendislik/api-tasarimi.md`. Var olan bir ucu örnek al (`apps/api/src/routes/`). Paketler birleşmediyse adlar kural ve belgedeki gibidir (paket birleşince doğrulanır).

1. **Sözleşme:** metod, yol (`/api/v1/<çoğul-kebab>`; komut `POST /<kaynak>/:id/<fiil>`), roller, kapsam (kendi sınıfı, çocuğu, tüm kurum). İlgili `docs/domain/*` kuralının kimliğini (`DOM-…`) ve varsa ister kimliğini (`IST-…`) brief'e yaz; kod yorumuna ve test adına da koy. Kural dosyada yoksa önce kuralı yaz.
2. **Route** (`src/routes/<alan>.ts`): `params`/`querystring`/`body` ve **`response`** şeması (`routes/<alan>.schemas.ts`; gövde = school-core işlem şeması). Oturum Better Auth'tan gelir; kimlik ve kurum `request.auth`'tan okunur, gövde/sorgudaki `institutionId` yok sayılır. Rol ve modül kontrolü burada; iş kuralı ve SQL yok.
3. **Servis** (`src/services/<alan>.ts`): `request` almaz; bağlam `{ db, institutionId, actor, now, log }`. Kurum kapsamlı depo (`src/db`) ile yükler, school-core işlemini çalıştırır, `version` ile iyimser kilitle tek transaction'da yazar. Okuma sonucu school-core kapsam fonksiyonuyla daraltılır. Arka plan işi gerekiyorsa `src/jobs` (pg-boss; yük yalnız kimlik).
4. **Yanıt ve hata:** başarı `{ data, meta? }`, liste `page`/`pageSize` (≤100) + `meta.total`; hata `{ code, message, issues?, requestId }` (`code` İngilizce snake_case, `message` Türkçe). Durumlar:
   - 400 Zod (`issues`), bilinmeyen sorgu parametresi
   - 401 oturumsuz
   - 403 rol/kapsam/modül kapalı/CSRF/taze oturum
   - 404 yok veya başka kurum
   - 409 sürüm/benzersizlik (`DomainError` kind `conflict`)
   - 422 `DomainError` kind `rule`
   - 429 hız sınırı; 500 ayrıntısı yalnız logda
5. **Idempotency-Key:** ödeme, iade, taksit/sözleşme oluşturma, toplu içe aktarma ve toplu gönderimde zorunlu; anahtar işlemle aynı transaction'da saklanır (`api-tasarimi.md` §7).
6. **OpenAPI ve istemci:** `apps/api/openapi.json` ve `packages/api-client/src/schema.d.ts` (`openapi-typescript`) yeniden üretilir, aynı committe, elle düzenlenmez. `api-client` `openapi-fetch` kullanır; uç başına elle fonksiyon yok. Gerekiyorsa `packages/react-shared` hook'u.
7. **Test** (`apps/api/test/<alan>.test.ts`, `app.inject` + PGlite, oturum Better Auth girişinden; her test kendi kurumunu kurar):
   - 401; 403 (yanlış rol, modül kapalı)
   - başka kurum kaydı 404 ve B değişmemiş; listede B kaydı yok; gövdedeki `institutionId` etkisiz
   - 400 ve kayıt değişmemesi; 409 sürüm; 422 kural reddi
   - başarı ve kalıcılık; mükerrer işlem (Idempotency-Key varsa aynı yanıt)
   - test adında domain kural kimliği (`DOM-…`)

   Kapsam eşiği api 85/80; hata düzeltmesi önce hatayı üreten testle gelir.

8. **Doğrula:** `dogrula` skill'i (`pnpm --filter @kampus/api test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`). Veritabanı katmanı değiştiyse `test:pg` takımı da.
