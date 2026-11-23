---
etki: minor
---

Gecikmiş taksitte elle hatırlatma (`docs/domain/finans.md` DOM-FIN-035, ON-113). Kural `packages/school-core/changes/taksit-elle-hatirlatma.md`'dedir.

- `POST /api/v1/finance/invoices/:invoiceId/remind` eklendi (yönetici, ön büro; `finance` modülü): `installment_overdue` bildirimi, `reminderAt` ve denetim satırı aynı transaction'da, kurum kilidi altında yazılır. Bugün zaten hatırlatıldıysa ya da tarama bugün gönderdiyse yeni bildirim yazılmaz, yanıt 200 `reminder: already_sent`. 422: `invoice_already_paid`, `invoice_not_overdue`, `invoice_student_archived`, `notifications_disabled`. `Idempotency-Key` isteğe bağlı, `If-Match` kabul edilmez.
- OpenAPI ve `api-client` şeması yeniden üretildi.
