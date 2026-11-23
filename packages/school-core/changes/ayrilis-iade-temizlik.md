---
etki: minor
---

- `reversePayment` ayrılmış öğrencide ayrılışta kalan borç taksitine sonradan alınan tahsilatı iptal eder, borç taksitini yeniden açar; ayrılış hesabına giren tahsilat yine `payment_student_withdrawn` ile reddedilir (DOM-FIN-041, DOM-FIN-033; ON-108). **Kırıcı:** `studentWithdrawn` girdisi kaldırıldı; yerine öğrencinin ayrılış kayıtları `withdrawals: [{ debtInvoiceId }]` verilir.
- `withdrawStudent` borç kaldığında açılan taksitin kimliğini dökümde döndürür (`breakdown.debtInvoiceId`); önizlemede alan yoktur.
