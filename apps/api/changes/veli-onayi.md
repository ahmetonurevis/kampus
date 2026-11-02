---
etki: minor
---

İzin formu ve dijital veli onayı uçları (OG-055; IST-067, DOM-ILT-030, -031, -036…039).

- Yeni uçlar (`routes/permission-forms.ts`, etiket `permission-forms`, modül `communication`): `GET /api/v1/permission-forms` (bekleyen, onay, ret sayılarıyla), `GET /api/v1/permission-forms/:formId` (öğrenci bazında durum ve görünen kararlar), `POST /api/v1/permission-forms` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/permission-forms/:formId`, `POST /api/v1/permission-forms/:formId/close`, `DELETE /api/v1/permission-forms/:formId` (kararsız formu arşivler), `POST /api/v1/permission-forms/:formId/decisions` (`Idempotency-Key` zorunlu; yeni karar 201, aynı karar 200). Var olan forma yazma `If-Match` ister.
- Veli yalnız velayetli ve kısıtsız bağlı çocuğu için karar verir, yalnız kendi kararını görür; öbür velinin reddi öğrencinin durumunda görünür. Durum yalnız bugün velayetli ve kısıtsız velilerin kararından hesaplanır (`student_guardians`); velayeti kalkan velinin kararı geçmişte kalır. 18 yaşını doldurmuş öğrenci (okulda da) kendisi karar verir; karar veren core `permissionDecider` ile kimlik satırındaki doğum tarihinden, yoksa dil okulunda adayın 18 yaş seçiminden belirlenir. Yetişkin öğrencinin formu veliye görünmez.
- Karar satırı ve velinin notu öğretmenlerden yalnız rehber öğretmene döner; ders öğretmeni yalnız durumu görür. Veli ve öğrenci yanıtında `classIds` ve `teacherId` yoktur.
- Form açılınca ve hedefe yeni giren öğrenciye aynı transaction'da `permission_form_opened` bildirimi yazılır; kitle kararı verenle aynıdır (`notify` yeni isteğe bağlı açık kitle `recipients.minor`).
- Hata kodları: 403 `permission_form_scope_denied`, `permission_form_not_owner`, `permission_adult_self`, `permission_guardian_required`; 409 `permission_form_closed`, `permission_form_has_decisions`; 422 `permission_form_deadline_in_past`, `permission_form_deadline_passed`, `permission_form_closed`, `permission_form_scope_locked`, `permission_form_no_students`.
- Migration yok (kayıtlar `records` koleksiyonlarında). OpenAPI ve api-client şeması yeniden üretildi.
