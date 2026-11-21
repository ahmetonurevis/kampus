---
etki: minor
---

Aday bilgisi düzeltme ucu eklendi: `PATCH /api/v1/prospects/:prospectId/details` (ON-282; DOM-KAY-003). Yönetici ve ön büro ad, telefon, e-posta, ilgi ve veli adını düzeltir; `If-Match` zorunludur, mükerrer ve onaylı e-posta kuralları 409/422 döner, denetim kaydına iletişim yazılmaz.
