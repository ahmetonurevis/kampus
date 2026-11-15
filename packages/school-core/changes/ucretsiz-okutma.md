---
etki: minor
---

- Ücretsiz okutma kuralları eklendi (ON-284, DOM-FIN-026; K-268…K-271): `lib/finance-free-tuition.ts` dönem ve kontenjan (`planFreeTuitionRound`, `planFreeTuitionQuota`; en az sayı `freeQuotaCount`), sabit gerekçe ve belge listeli aday (`planFreeTuitionApplication`, `planFreeTuitionDocuments`), değerlendirme kurulu kararı (`planFreeTuitionBoard`, `applyFreeTuitionBoard`), kabulde açık öğrenim taksitlerinin kapanması ve alınan öğrenim ücretinin iadesi (`applyFreeTuitionWaiver`, `freeTuitionRefundDueDate`, `planFreeTuitionRefund`), MEBBİS işareti (`planFreeTuitionMebbis`) ve ek protokol engeli (`assertContractNotFreeTuition`).
- `quoteWithdrawal` bağlamına `freeTuitionContractIds` eklendi: ücretsiz okutmalı sözleşmede ayrılış öğrenim ücreti istemez ve alınmış öğrenim ücretini yeniden iade etmez.
- `reversePayment` ücretsiz okutma iadesine giren taksite dağıtılmış tahsilatı `payment_free_tuition_refunded` (409) ile reddeder (`freeTuitionInvoiceIds`).
