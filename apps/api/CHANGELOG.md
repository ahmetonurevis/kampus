# Değişiklikler

API henüz sürümlenmemiş (`0.1.0`); değişiklikler en yenisi üstte listelenir.

## Optik değerlendirme ve otomatik etüt köprüsü

- `POST /api/v1/assessment/<komut>[/:recordId]`: core `ASSESSMENT_COMMANDS`'ın yedi komutu (`profile`, `evaluate`, `plan`, `slot`, `slot-remove`, `cancel`, `attendance`) `runAssessment` ile tek transaction'da. Rol, kapsam ve modül (`optical`, `tutoring`) core'dadır; `evaluate` ve `plan` `Idempotency-Key` ister, kayıtlı komutlarda `If-Match` kaydın sürümüdür. Yanıt `CommandResult`; denetim eylemi `assessment.<komut>`.
- Okuyucu dosyası gövdede metin (`text`, `keyCsv`): alan başına 1 MB (aşarsa 413 `payload_too_large`, gövde tavanı bu rotalarda 4 MiB), dosya hataları 422 ve `issues[0].path = [alan, "line", satır]`.
- `POST /api/v1/assessment/plan/preview` ve `/evaluate/preview`: saf önizleme (işlem çalıştırıcının hattı, sonuç `after` kancasında transaction geri alınarak çıkarılır; satır, sürüm ve denetim kaydı değişmez). Plan yanıtı `sessions`, `unresolved` (neden), `covered`, `summary`, `expectedPlan`; değerlendirme yanıtı özet ve `digest`.
- Onayda fark: `plan` + `expectedPlan` bayatsa 409 `tutoring_plan_stale` ve `issues` içinde plan farkı; `evaluate` + `expectedDigest` bayatsa 409 `evaluation_stale`. Hiçbir şey yazılmaz.
- `services/commands.ts`: `execute`, `auditEntity`, `auditedEntity`, `Entity` dışa aktarıldı (yeni servis kullanır; davranış değişmedi). OpenAPI ve istemci şeması yeniden üretildi.
- Eski `POST /tutor-sessions*` uçları değişmedi.
- Şema değişikliği ve migration yok.

## Kurum modül ayarı

- `GET /api/v1/modules` (yönetici): kurum türünde bulunan modüller, açık/kapalı durumları ve `If-Match` için ayar sürümü.
- `PATCH /api/v1/modules/:moduleKey` (yönetici, gövde `{ enabled }`): modülü açar/kapatır (DOM-YTK-040, DOM-YTK-042). `If-Match` (`institution_settings.version`) ve `Idempotency-Key` zorunludur. Tek transaction'da kurum kilidi, sürüm denetimi, school-core `setModuleEnabled`, `institutions.enabled_modules` ve sürüm güncellemesi, `audit_log` (`module.set`, `changes.fields: ['enabledModules']`). Kurum türünde olmayan modül 422 `module_unavailable_for_type`, değişmeyen durum 409 `module_unchanged`, eski sürüm 409 `version_conflict`. Kapatma veri silmez; kapalı modülün uçları 403 `module_disabled` döner, açılınca kayıtlar aynen görünür.
- Hata mesajı `if_match_required` eklendi. Şema değişikliği ve migration yok.
- `test/support/pg.ts`: `test:pg` dosyaları paralel migrate ederken benzersizlik hatası almasın diye migrate yeniden denenir.
