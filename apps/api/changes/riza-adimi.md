---
etki: minor
---

- `GET /api/v1/consents/status` her amaçta `grantor` döndürür (`self`, `guardian`, `null`): rızayı kimin verdiği core `consentGrantor` ile yaştan hesaplanır, doğum tarihi dönmez; öğretmene dönmez (DOM-YTK-057, DOM-YTK-061).
- `Consent` yanıtına (`GET /consents`, `POST /consents`, geri çekme) `canWithdraw` eklendi: oturumdaki kullanıcı satırı şu anda geri çekebilir mi (core `mayWithdrawConsent`, DOM-YTK-059).
- OpenAPI ve api-client şeması yeniden üretildi; migration yok.
