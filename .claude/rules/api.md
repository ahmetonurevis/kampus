---
paths:
  - 'apps/api/**'
  - 'packages/api-client/**'
---

# API kuralları

- Fastify 5 + TypeScript (strict), Node 24 tür ayıklamasıyla doğrudan `.ts` çalışır.
- Katmanlar: `src/routes` (HTTP, şema, kimlik), `src/services` (iş akışı; school-core kurallarını çağırır), `src/db` (Drizzle şeması, sorgular). Route içinde SQL veya iş kuralı yazılmaz.
- Girdi/çıktı şemaları Zod; varsa school-core şeması yeniden kullanılır. Doğrulama hatası 400 + Türkçe `message` + alan bazlı `issues`; yetkisiz 401, yasak 403, başka kuruma ait kayıt 404, sürüm çakışması 409; beklenmeyen hata 500 + genel Türkçe mesaj, ayrıntı yalnız logda.
- Kiracı izolasyonu: her sorgu `institution_id` ile süzülür; kurum kimliği yalnız doğrulanmış oturumdan gelir, istek gövdesinden veya sorgudan okunmaz.
- Yazma işlemleri tek veritabanı işleminde yapılır; başarısızlıkta hiçbir kayıt değişmez. Kayıtlar `version` ile iyimser kilitlenir.
- Migration'lar drizzle-kit ile üretilir ve commit edilir; uygulanmış migration düzenlenmez, yenisi eklenir.
- Parola scrypt ile özetlenir; gizli anahtar ve bağlantı bilgisi ortam değişkeninden gelir (`.env.example` güncel tutulur), koda yazılmaz, loglanmaz.
- Her uç için test: kimliksiz (401), yanlış rol (403), başka kurum (404), geçersiz girdi (400), başarı ve kalıcılık. Testler `app.inject` ve PGlite ile çalışır.
- `api-client` uçların tek tipli istemcisidir; uç eklenince istemci ve tipi aynı committe güncellenir.
