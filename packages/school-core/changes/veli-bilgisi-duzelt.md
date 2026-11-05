---
etki: minor
---

- `updateParentDetails` ve `updateParentDetailsSchema` eklendi (ON-117, DOM-KAY-012, `lib/registration-records.ts`): kesin kayıtta açılan veli kaydının adı, telefonu ve e-postası düzeltilir; gönderilmeyen alan aynı kalır, boş e-posta siler, telefon silinemez. Değişiklik yoksa 409 `parent_unchanged`, kayıt yoksa 404 `parent_not_found`. Yeni yazma eylemi `parent.update` (yönetici, ön büro; modül `crm`).
- API: `PATCH /api/v1/parents/:parentId` (`If-Match` zorunlu; denetime yalnız alan adları).
