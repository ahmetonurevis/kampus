---
etki: minor
---

- `POST /api/v1/prospects/:prospectId/enroll`, yenileme ve sözleşme ek protokolü kardeş indirimini yalnız ücreti düşük çocuğa uygular; adayın ilan ücreti aktif kardeşlerinkinden yüksekse 422 `sibling_discount_ineligible` döner (DOM-FIN-022; ON-109). OpenAPI ve `api-client` şeması yeniden üretildi.
