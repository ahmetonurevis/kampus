---
etki: minor
---

İzin/mazeret bildirimine özür belgesi ve idare onayı (OG-044, IST-072; `docs/domain/iletisim-ve-veli.md` DOM-ILT-053). API tarafı `apps/api/changes/mazeret-onayi.md`'dedir.

- **Kırıcı:** `notifyAbsenceSchema` eski `files` alanını artık kabul etmez (katı şema, 400); belge kimlikleri `fileIds` ile gelir. Eski alan yalnız boş diziyle geçerdi, bilinen istemci göndermiyordu.
- `content/taxonomy.ts` içine dosya amacı `absence_document` (PDF/JPEG/PNG, en çok 10 MB, bildirim başına en çok 3, KVKK özel nitelikli olabilir).
- `lib/requests.ts`: `ABSENCE_APPROVAL_STATUSES`/`LABELS`, `ABSENCE_DOCUMENT_PURPOSE`/`LIMIT`, `AbsenceFile`, `attachAbsenceDocumentsSchema`, `approveAbsenceSchema`, `rejectAbsenceSchema`, `attachAbsenceDocuments`, `approveAbsence`, `rejectAbsence`, `absenceApprovalStatus` (alanı olmayan eski kayıt `pending`), `attendanceExcuse`. Onay `status` metnini de günceller. Red gerekçesi kayda yazılmaz.
- Yeni bildirim listenin sonuna eklenir (önceden başa): API öğrencinin bildirimlerini kısmi yükler ve yalnız sona eklemeye izin verir; başa ekleme aynı öğrencinin ikinci bildiriminde 500'e yol açıyordu.
- `platform/`: `absence.attach` (veli), `absence.approve`/`absence.reject` (yalnız yönetici) yetki ve komutları; `decidedBy` öğrenci ve veliye gizli; bildirim türü `absence_decided` (zorunlu, `academic`).
