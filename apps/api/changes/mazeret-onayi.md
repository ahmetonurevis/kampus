---
etki: minor
---

İzin/mazeret bildirimine özür belgesi ve idare onayı (OG-044, IST-072; `docs/domain/iletisim-ve-veli.md` DOM-ILT-053). Core tarafı `packages/school-core/changes/mazeret-onayi.md`'dedir.

- **Kırıcı:** `POST /api/v1/absences` gövdesinde eski `files` alanı 400 olur; özür belgeleri `fileIds` ile, aynı transaction'da bildirime bağlanır (`attached_type` `absence`; başka kayda bağlı 409 `file_already_attached`). `absence_files_unsupported` kalktı.
- Yeni uçlar (`If-Match` zorunlu): `POST /api/v1/absences/:absenceId/documents` (veli, karar verilmeden ve belge süresi içinde), `/approve` ve gerekçeli `/reject` (yalnız yönetici; ikinci karar 409 `absence_already_decided`). Red gerekçesi yalnız `audit_log.reason`'a yazılır. Karar veliye sonuçsuz `absence_decided` bildirimiyle gider.
- Dosya amacı `absence_document`: yalnız veli yükler; veli, öğrenci, yönetici ve sınıf rehber öğretmeni açar, her bağlantı `file.access` denetiminde.
- Migration 0045: `files_purpose_check` kısıtına `absence_document` eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.
