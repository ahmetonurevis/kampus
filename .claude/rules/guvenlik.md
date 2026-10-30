---
paths:
  - 'apps/api/**'
  - 'packages/**'
---

# Güvenlik ve KVKK kuralları

Ayrıntı: `docs/muhendislik/guvenlik-kvkk.md`.

- Kurum kimliği yalnız doğrulanmış belirteçten gelir (`request.ctx.institutionId`); gövde, sorgu, yol veya başlıktaki kurum kimliği okunmaz. Başka kurumun kaydı 404.
- Bütün veri erişimi kurum kapsamlı depo fonksiyonlarından geçer; ilk parametre `institutionId`.
- Varsayılan ret: her rota `requireRole` bildirir; kayıt kapsamı school-core kapsam fonksiyonlarıyla, alan kapsamı role özgü yanıt şemasıyla. İstemcideki gizleme güvenlik değildir.
- Parola scrypt (`N=2^17, r=8, p=1`), `timingSafeEqual`; en az 12 karakter, bileşim kuralı yok, yapıştırma serbest. Giriş hatası tek mesaj: "E-posta veya parola hatalı."
- Erişim JWT 15 dk, rol/kapsam belirtece yazılmaz. Yenileme belirteci özeti saklanır, her kullanımda döner; yeniden kullanımda aile iptal edilir ve denetim kaydına yazılır.
- Hız sınırı giriş, parola sıfırlama, yenileme ve içe/dışa aktarma uçlarında zorunlu; 429 + `Retry-After`.
- CORS izin listesi ortamdan, `*` yok. Güvenlik başlıkları `@fastify/helmet`; kişisel veri yanıtında `Cache-Control: no-store`.
- Yeni kişisel alan şemada sınıfıyla işaretlenir (`// kvkk: K|Ç|Ö`). Özel nitelikli (Ö: sağlık, din, biyometrik) veri `records.data`'ya yazılmaz; ayrı tablo, şifreli kolon, okuması denetim kaydında.
- Gerekçelendirilemeyen veri toplanmaz. Rıza gerekiyorsa amaç bazlı, sürümlü, geri çekilebilir ve `consents` tablosunda.
- Loglanmaz: parola, belirteç, çerez, `Authorization`, gövde, e-posta, telefon, T.C. kimlik no, serbest metin, Ç/Ö değerleri. Yeni hassas alan pino `redact` listesine aynı committe eklenir.
- Sır yalnız ortam değişkeninde; `config.ts` doğrular. `.env` commit edilmez, `.env.example` yer tutucuyla güncel. `EXPO_PUBLIC_*`/`VITE_*` sır taşımaz.
- SQL yalnız parametreli; kullanıcı girdisiyle `sql.raw` ve jsonb yolu yok. Dosya türü içerikten tespit edilir, ad sunucuda üretilir.
- Bağımlılık eklerken lisans izin listesi ve gerekçe (`docs/muhendislik/kod-yazim.md` §8); `pnpm audit` yüksek/kritik açık birleştirmeyi engeller.
