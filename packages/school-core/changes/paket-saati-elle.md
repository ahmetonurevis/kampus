---
etki: minor
---

- Paket kullanılan saati elle girilir, paket ayrılışında iade tutarı yönetici onayından geçer (ON-300, K-21; DOM-DIL-051, DOM-FIN-040): `planPackageUsedHours`, `setPackageUsedHoursSchema`, `packageUsedHoursRecorded`, `refundApprovalRequired`; saat kaynağına `manual` eklendi. `withdrawStudent` paket satışı hesaba giriyorsa `approvedRefundCents` ister (`withdrawal_refund_approval_required`, `withdrawal_refund_changed`), döküm satırı `usedHoursMissing` taşır, `contractLineRows` bunu yazar.
