---
name: api-ucu
description: Kampüs API'sine (apps/api, Fastify + Drizzle + PostgreSQL) yeni uç ekleme kontrol listesi — route, Zod şeması, kimlik ve kurum kapsamı, school-core kuralıyla servis, transaction, testler ve api-client güncellemesi. Yeni okuma/yazma ucu eklerken veya bir modülü API'ye taşırken kullan.
argument-hint: <metod ve yol, ör. POST /api/v1/workflows/:command>
---

# API ucu ekleme

Kurallar `.claude/rules/api.md` içindedir. Var olan bir ucu örnek al (`apps/api/src/routes/`).

1. **Sözleşme:** metod, yol (`/api/v1/...`), girdi/çıktı Zod şeması (varsa school-core şeması), hangi roller, hangi kapsam (kendi sınıfı, kendi çocuğu, tüm kurum).
2. **Route** (`src/routes/<alan>.ts`): şema, `authenticate` ön işleyicisi, rol kontrolü; iş kuralını servise devreder. Kurum kimliği `request.user.institutionId`'den gelir.
3. **Servis** (`src/services/<alan>.ts`): gereken koleksiyonları kurum kapsamında yükler, school-core işlemini çalıştırır, değişen kayıtları sürüm kontrolüyle tek transaction'da yazar. Okuma ucu sonucu school-core kapsam fonksiyonuyla daraltır.
4. **Hata eşlemesi:** Zod → 400 (`issues`), yetki → 403, başka kurum → 404, sürüm → 409; mesajlar Türkçe.
5. **Test** (`apps/api/test/<alan>.test.ts`): 401, 403, başka kurum 404, 400 ve kayıt değişmemesi, başarı ve kalıcılık, mükerrer işlem.
6. **İstemci:** `packages/api-client` metodu ve tipi; gerekiyorsa `packages/react-shared` hook'u.
7. **Doğrula:** `pnpm --filter @kampus/api test`, `pnpm typecheck`, `pnpm lint`.
