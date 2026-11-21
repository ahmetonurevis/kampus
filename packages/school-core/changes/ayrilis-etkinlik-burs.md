---
etki: minor
---

- Ayrılış hesabı kesilen ve geri istenen bursu okur (ON-342, K-350, K-351): `WithdrawalContext.scholarshipEnds`; ayrılış gününde yürürlükteki kesmede (kesme günü burslu sayılır) ve her iptalde burslu istisnası kalkar, kalkan burs payı tabana eklenir (`WithdrawalContractLine.scholarshipEnd`, `scholarshipEndAtWithdrawal`). Geri isteme alacağı `WithdrawalBreakdown.scholarshipClawbacks` satırıdır; iade ve borca girmez, ayrılış iptal etmez (`scholarshipEndClawbackInvoiceIds`).
- Ayrılışta gezi ve etkinlik katılımları (ON-342, K-348, K-349): yeni `lib/withdrawal-followups.ts` (`quoteWithdrawalWithFollowups`, `withdrawStudentWithFollowups`, `withdrawalFollowupSections`). Etkinlik günü ayrılış gününden sonra olan katılım etkinliğin kuralıyla ayrılış gününe göre iptal edilir; gerçekleşmiş etkinliğin ödenmemiş kısmı borç kalır. Satırlar `WithdrawalBreakdown.activities`'tedir, iade ve borca girmez.
- Taksit listesi olmayan eski sözleşme ve yenileme sözleşmesi ayrılışta etkinlik taksitini ve geri isteme alacağını saymaz, iptal etmez.
