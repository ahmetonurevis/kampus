# Değişiklikler

API henüz sürümlenmemiş (`0.1.0`); değişiklikler en yenisi üstte listelenir.

## Kurum modül ayarı

- `GET /api/v1/modules` (yönetici): kurum türünde bulunan modüller, açık/kapalı durumları ve `If-Match` için ayar sürümü.
- `PATCH /api/v1/modules/:moduleKey` (yönetici, gövde `{ enabled }`): modülü açar/kapatır (DOM-YTK-040, DOM-YTK-042). `If-Match` (`institution_settings.version`) ve `Idempotency-Key` zorunludur. Tek transaction'da kurum kilidi, sürüm denetimi, school-core `setModuleEnabled`, `institutions.enabled_modules` ve sürüm güncellemesi, `audit_log` (`module.set`, `changes.fields: ['enabledModules']`). Kurum türünde olmayan modül 422 `module_unavailable_for_type`, değişmeyen durum 409 `module_unchanged`, eski sürüm 409 `version_conflict`. Kapatma veri silmez; kapalı modülün uçları 403 `module_disabled` döner, açılınca kayıtlar aynen görünür.
- Hata mesajı `if_match_required` eklendi. Şema değişikliği ve migration yok.
- `test/support/pg.ts`: `test:pg` dosyaları paralel migrate ederken benzersizlik hatası almasın diye migrate yeniden denenir.
