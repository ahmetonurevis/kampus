---
etki: minor
---

Dijital veli onayı ve izin formu kuralları eklendi (OG-055; IST-067, DOM-ILT-036…039).

- Yeni `lib/permission-forms.ts`: `createPermissionForm`, `updatePermissionForm`, `closePermissionForm`, `archivePermissionForm`, `decidePermission`, geçerli durum (`permissionStatus`, `permissionCounts`), son gün (`isPermissionFormOpen`, `permissionDeadlineEndsAt`) ve hatırlatılacaklar (`permissionReminders`) ile gövde şemaları. Konu türü gezi, etkinlik, fotoğraf çekimi, kulüp, diğer; son gün Europe/Istanbul günü.
- Yeni koleksiyonlar `permissionForms` ve `permissionDecisions` (modül `communication`; örnek veride boş). Okul takvimi etkinlik onayı (`eventConsents`) değişmedi.
- Komut ve yetki tablosuna `permissionForm.create`, `.update`, `.close`, `.archive` (yönetici, sınıf rehber öğretmeni) ve `.decide` (veli, 18 yaşını doldurmuş öğrenci) eklendi. Her velinin kararı ayrı satırdır, ret geçerlidir; son günden sonra karar değişmez (422 `permission_form_deadline_passed`); kararı olan formun hedefi daraltılamaz (422 `permission_form_scope_locked`).
- Kapsam: veli yalnız kendi kararını görür; kararı verenin kullanıcı kimliği yalnız yöneticiye döner.
- Yeni bildirim türleri `permission_form_opened`, `permission_form_reminder` (konu `consent`, zorunlu, 18 yaş altında veli, yetişkinde kendisi).
- `decidePermission` kimlik satırındaki doğum tarihini `options.birthDate` ile alır; verilirse öğrenci kaydındakinin yerine geçer (API kimlik verisini `student_identities`te tutar).
