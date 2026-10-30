---
paths:
  - 'apps/api/**'
  - 'packages/**'
---

# Güvenlik ve KVKK kuralları

Ayrıntı: `docs/muhendislik/guvenlik-kvkk.md`. Kimlik ve oturum Better Auth'tadır (ADR 0002); yapılandırma tek dosyada: `apps/api/src/auth.ts`.

- Parola özeti, oturum, belirteç, çerez ve kimlik uçlarındaki hız sınırı için kod yazılmaz; Better Auth yapılandırılır. `jose`/`jsonwebtoken`/`bcrypt`/`argon2` eklenmez, özel `password.hash` yazılmaz.
- Better Auth: `emailAndPassword`, `disableSignUp: true` (hesabı kurum açar), `minPasswordLength: 12`, `maxPasswordLength: 128`, `revokeSessionsOnPasswordReset: true`, sıfırlama belirteci 30 dk. Yaygın parola ve e-posta/kurum adı türevleri `hooks.before` ile reddedilir; parola dış servise gönderilmez.
- Oturum veritabanında: `expiresIn` 14 gün, `updateAge` 1 gün, `freshAge` 15 dk, `cookieCache` kapalı. Hassas işlem (iade, rol/üyelik, dışa aktarma, silme talebi) taze oturum ister → 403 `reauthentication_required`.
- Giriş hatası tek mesaj: "E-posta veya parola hatalı."; sıfırlama yanıtı hesabın varlığını belli etmez.
- Kurum kimliği yalnız oturumun etkin kurumundan (`session.activeOrganizationId`) gelir; gövde/sorgu/yol/başlıktaki kurum kimliği okunmaz. Her istekte üyelik doğrulanır. Başka kurumun kaydı 404.
- Bütün veri erişimi kurum kapsamlı depo fonksiyonlarından geçer; ilk parametre `institutionId`. `pg-boss` iş yükü kurum kimliği taşır, kişisel veri taşımaz.
- Varsayılan ret: her rota `requireRole` bildirir; roller Better Auth access control ile, kayıt kapsamı school-core kapsam fonksiyonlarıyla, alan kapsamı role özgü yanıt şemasıyla.
- Hız sınırı: kimlik uçlarında Better Auth `rateLimit` (testte de açık), diğer uçlarda `@fastify/rate-limit`; 429 + `Retry-After`.
- CORS izin listesi ortamdan, `*` yok; aynı liste Better Auth `trustedOrigins`'te. Çerez oturumu nedeniyle değiştiren isteklerde `Sec-Fetch-Site: cross-site` veya izinsiz `Origin` → 403 `csrf_rejected`. Güvenlik başlıkları `@fastify/helmet`.
- Yeni kişisel alan şemada sınıfıyla işaretlenir (`// kvkk: K|Ç|Ö`). Özel nitelikli (Ö) veri `records.data`'ya yazılmaz; ayrı tablo, şifreli kolon, okuması denetim kaydında.
- Loglanmaz: parola, çerez, `Authorization`, gövde, e-posta, telefon, T.C. kimlik no, serbest metin, Ç/Ö değerleri. Yeni hassas alan pino `redact` listesine aynı committe eklenir.
- Sır yalnız ortamda (`BETTER_AUTH_SECRET` ≥ 32 bayt, `DATABASE_URL` …); `config.ts` doğrular. `.env` commit edilmez, `.env.example` yer tutucuyla güncel. `EXPO_PUBLIC_*`/`VITE_*` sır taşımaz.
- SQL yalnız parametreli; kullanıcı girdisiyle `sql.raw` ve jsonb yolu yok. Dosya türü içerikten tespit edilir, ad sunucuda üretilir.
- Better Auth sürümü tam sabit; güncellemede şema yeniden üretilir, fark migration olur. `pnpm audit` yüksek/kritik açık birleştirmeyi engeller.
