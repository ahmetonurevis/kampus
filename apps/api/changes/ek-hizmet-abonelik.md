---
etki: minor
---

Ek hizmet aboneliği uçları eklendi (ON-087; DOM-FIN-003): `GET/POST /api/v1/finance/student-services`, `GET …/:serviceId`, `POST …/:serviceId/end`. Ayrılış açık abonelikleri aynı işlemde kapatır; tarifeli yenileme aynı yılın açık aboneliğindeki ek hizmeti 409 ile reddeder. Migration `0074`: `student_services`, `student_service_invoices`, `invoices_fee_kind_check` kısıtına `club`.

Ayrılıştan sonra abonelik taksitine alınan tahsilat iptal edilir; önceki davranış 409 `payment_student_withdrawn` idi (DOM-FIN-041).

Yazılma `amountCents` ile birim tutarı tarifenin altına düzeltir, denetime `studentService.amountAdjust` yazar (K-17). Yeni uç `GET /api/v1/finance/student-services/quote`: önerilen tutar ve vadeler. Migration `0074`: `tariff_amount_cents`.
