---
etki: minor
---

Burs programı uçları eklendi (ON-014; DOM-FIN-025): `GET/POST /api/v1/finance/scholarship-programs`, `POST …/:programId/notify`, `GET /api/v1/finance/scholarship-awards`, `POST …/:awardId/mebbis-record`. `POST /api/v1/prospects/:prospectId/enroll` isteğe bağlı `scholarshipProgramId` alır; atamayı aynı işlemde yazar. Migration `0031`: `scholarship_programs`, `scholarship_awards`.
