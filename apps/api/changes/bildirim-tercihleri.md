---
etki: minor
---

Bildirim tercihleri ve sessiz saat uçları (OG-107 adım 1; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-021). Core tarafı `packages/school-core/changes/bildirim-tercihleri.md`'dedir.

- Yeni uçlar: `GET /api/v1/notification-preferences` (oturum sahibinin tercihi; kayıt yoksa varsayılan ve `version: 1`) ve `PATCH /api/v1/notification-preferences` (gövdede `version`; `topics` birleştirilir, `quietHours` ve `children` bütün olarak değişir). Modül `communication`, kapalıysa 403 `module_disabled`. Hatalar: 400 geçersiz gövde, 409 `version_conflict`, 422 `notification_channel_required` (zorunlu konuda uygulama içi ve anlık bildirim kapatılamaz), `quiet_hours_invalid`, `notification_children_parent_only` (çocuk kırılımı yalnız veli).
- Yeni tablo `notification_preferences` (migration 0059): kullanıcı ve kurum başına bir satır, JSON tercih ve `version` (iyimser kilit). Başka kullanıcının tercihi okunmaz ya da yazılmaz; kurum ve kullanıcı oturumdan gelir.
- Tercih bildirim gönderiminde henüz uygulanmaz (`TODO(bildirim-tercihleri-teslim)`, `services/notify.ts`); kurum sessiz saat sınırı ayarı yoktur (`TODO(bildirim-tercihleri-kurum-siniri)`).
- OpenAPI ve `api-client` şeması yeniden üretildi.
