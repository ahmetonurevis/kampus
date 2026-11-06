---
etki: minor
---

Ek hizmet aboneliği uçları eklendi (ON-087; DOM-FIN-003): `GET/POST /api/v1/finance/student-services`, `GET …/:serviceId`, `POST …/:serviceId/end`. Ayrılış açık abonelikleri aynı işlemde kapatır; tarifeli yenileme aynı yılın açık aboneliğindeki ek hizmeti 409 ile reddeder. Migration `0065`: `student_services`, `student_service_invoices`.
