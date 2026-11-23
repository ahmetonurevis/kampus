---
etki: minor
---

`GET /api/v1/privacy-notices/current` isteğe bağlı `audience` sorgu parametresi aldı (iş isteği #14; DOM-KAY-003). `audience=aday` aday formunun güncel metnini ve sürümünü döndürür; yalnız yönetici ve ön büro okur, diğer roller ve başka hesap kitlesi 403 `notice_audience_forbidden`, bilinmeyen kitle ya da parametre 400. Aday kitlesinde gösterim kaydı yoktur (`needsAcknowledgement` hep yanlış). Migration 0038 `privacy_notices` kitle kısıtına `aday`ı ekler.
