---
etki: minor
---

Kayıp aday nedeni ve rakip analizi (`docs/domain/kayit-ve-crm.md` DOM-KAY-005, IST-117, ON-140). Kural `packages/school-core/changes/kayip-aday-kirilimi.md`'dedir.

- `PATCH /api/v1/prospects/:prospectId` gövdesine isteğe bağlı `lostToInstitution` eklendi (en çok 120 karakter, yalnız `Vazgeçti`). Değer pino `redact` listesindedir, denetime yalnız alan adı düşer.
- `GET /api/v1/prospects/loss-breakdown` eklendi (yönetici, ön büro; `crm` modülü): vazgeçen adayların neden ve tercih edilen kurum kırılımı; yalnız sayı ve kurum adı döner.
- OpenAPI ve `api-client` şeması yeniden üretildi.
