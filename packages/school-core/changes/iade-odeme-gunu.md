---
etki: patch
---

- İade ödemesi ayrılış gününden önceki bir güne yazılamaz (ON-093; DOM-FIN-041, IST-110): `planRefundPayment` ayrılış gününü alır, önceki gün 422 `refund_date_before_withdrawal` verir.
