---
etki: minor
---

- Oturum listesinden oturum belirteci kaldırıldı (IST-025): `GET /api/v1/auth/list-sessions` satırları `token` taşımaz; tek oturum `POST /api/v1/auth/revoke-session` `{ sessionId }` ile kapatılır, başkasının oturum kimliği hiçbir şey kapatmaz. **Kırıcı:** `revokeSession({ token })` çağıran istemci `{ sessionId }` göndermeli (`@kampus/react-shared` `AccountSecurityClient.revokeSession`).
- Oturum kapatma uçları (`/revoke-session`, `/revoke-other-sessions`, `/revoke-sessions`) taze oturum ister; eski oturumda 403 `SESSION_NOT_FRESH`, web parola penceresini açıp işlemi tekrarlar.
- Hesap başına giriş sınırı eklendi: bir e-postayla 15 dk içinde en çok 10 giriş denemesi (başarılı giriş dahil) yapılır; sonrası pencere bitene kadar 429 alır, eşzamanlı istekler de sayılır. Hesap olsun olmasın yanıt aynıdır.
- Parola sıfırlamada e-posta ve kurum adı türevi de reddedildi (hesap sıfırlama belirtecinden çözülür).
- React web Güvenlik sayfasına "Oturumlarım" bölümü eklendi: cihaz özeti, son etkinlik, "Bu oturum" işareti; "Bu oturumu kapat" ve "Diğer tüm oturumları kapat" onay penceresiyle.
