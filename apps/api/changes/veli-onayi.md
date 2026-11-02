---
etki: minor
---

İzin formu ve dijital veli onayı uçları (OG-055; IST-067, DOM-ILT-030, -031, -036…039).

- Yeni uçlar (`routes/permission-forms.ts`, etiket `permission-forms`, modül `communication`): `GET /api/v1/permission-forms` (bekleyen, onay, ret sayılarıyla), `GET /api/v1/permission-forms/:formId` (öğrenci bazında durum ve görünen kararlar), `POST /api/v1/permission-forms` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/permission-forms/:formId`, `POST /api/v1/permission-forms/:formId/close`, `DELETE /api/v1/permission-forms/:formId` (kararsız formu arşivler), `POST /api/v1/permission-forms/:formId/decisions` (`Idempotency-Key` zorunlu; yeni karar 201, aynı karar 200). Var olan forma yazma `If-Match` ister.
- Veli yalnız velayetli ve kısıtsız bağlı çocuğu için karar verir, yalnız kendi kararını görür; öbür velinin reddi öğrencinin durumunda görünür. 18 yaşını doldurmuş öğrenci kendisi karar verir; yaş kimlik satırındaki doğum tarihinden, yoksa öğrenci kaydından okunur.
- Form açılınca ve hedefe yeni giren öğrenciye aynı transaction'da `permission_form_opened` bildirimi yazılır.
- Hata kodları: 403 `permission_form_scope_denied`, `permission_form_not_owner`, `permission_adult_self`, `permission_guardian_required`; 409 `permission_form_closed`, `permission_form_has_decisions`; 422 `permission_form_deadline_in_past`, `permission_form_deadline_passed`, `permission_form_closed`, `permission_form_scope_locked`, `permission_form_no_students`.
- Migration yok (kayıtlar `records` koleksiyonlarında). OpenAPI ve api-client şeması yeniden üretildi.
