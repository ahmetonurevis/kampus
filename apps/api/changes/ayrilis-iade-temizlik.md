---
etki: minor
---

- `POST /api/v1/payments/:paymentId/reverse` ayrılmış öğrencinin ayrılıştan sonra kalan borca alınan tahsilatını iptal eder; ayrılıştan önceki tahsilat 409 `payment_student_withdrawn` almaya devam eder (DOM-FIN-041; ON-108). Borç taksitinin kimliği `student_withdrawals.breakdown` içinde saklanır; alanı olmayan eski ayrılışlarda bütün tahsilatlar reddedilir.
- `POST /api/v1/withdrawals/:withdrawalId/pay-refund` `Idempotency-Key` kaydına maskeli IBAN ve hesap sahibini yazmaz; tekrar yanıtı bu alanları iade kaydından ekler, yanıt sözleşmesi değişmedi (guvenlik-kvkk.md §10; ON-108). OpenAPI ve `api-client` şeması yeniden üretildi.
