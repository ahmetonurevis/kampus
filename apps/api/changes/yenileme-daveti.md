---
etki: minor
---

Yenileme daveti uçları eklendi (ON-056, K-10, IST-100; DOM-KAY-027): `GET/POST /api/v1/finance/renewal-invitations` ve `POST /api/v1/finance/renewal-invitations/:invitationId/respond`. Yenileme önizlemesi (`POST /api/v1/finance/renewals/quote`) `invitationStatus` döner. Migration `0064`: `renewal_invitations`.
