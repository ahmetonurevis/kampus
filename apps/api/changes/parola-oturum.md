---
etki: minor
---

Parola sıfırlama, parola değiştirme ve oturum listesi (IST-003; OG-035).

- Parola sıfırlama çalışır: `POST /api/v1/auth/request-password-reset` hesabın varlığını belli etmeden (gövde, durum ve süre aynı) bağlantı üretir; bağlantı `WEB_URL/parola-sifirla#token=…` biçimindedir (belirteç adres parçasında, API'ye ve erişim loguna gitmez), `GET /reset-password/:token` yönlendirmesi kapalıdır. Belirteç 30 dk geçerli, tek kullanımlık ve özetle saklanır; sıfırlama ya da `change-password` sonrası kullanıcının bekleyen bütün belirteçleri silinir ve bütün oturumlar kapanır.
- Yeni ortam değişkenleri: `WEB_URL` (sıfırlama bağlantısının web kökü; üretimde yoksa ileti gönderilmez) ve `MAIL_DRIVER=log|memory|none` (varsayılan: geliştirmede `log`, testte `memory`, üretimde `none`; üretimde `log` ve `memory` başlangıçta reddedilir). Gerçek e-posta sağlayıcısı OG-095'tedir.
- Taciz sınırı: IP başına saatte 3 (değişmedi) ve hesap başına açık belirteç varken 5 dk soğuma ile saatte en çok 3 ileti; reddedilen istek yine 200 ve aynı gövdeyi döndürür, belirteç satırı yazmaz. İleti yanıt beklenmeden arka planda gider.
- **Davranış değişikliği:** `GET /api/v1/auth/list-sessions` yanıtı daraldı (KVKK veri en azı): `id`, `token`, `createdAt`, `updatedAt`, `expiresAt`, `device` (kaba tarayıcı/işletim sistemi özeti), `current`; `ipAddress` ve `userAgent` artık dönmez.
- `change-password` `revokeOtherSessions: true` ile çalışır; bu cihaza yeni oturum açılır ve etkin kurum korunur.
- Denetim: `auth.password_reset_requested` oturumsuz olduğundan `actorUserId` boştur, hesap `entityType='user'`/`entityId` alanındadır; `auth.password_reset_completed` eklendi.
- OpenAPI ve `api-client` şeması değişmedi (kimlik uçları Better Auth'undur).
