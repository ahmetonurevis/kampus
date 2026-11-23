---
etki: minor
---

- Kayıt sözleşmesi onayı ve ek protokol eklendi (IST-092; DOM-FIN-010, -012, -051): `lib/contract-approval.ts` (`setContractSignatory`, `approveContract`, `amendContract`, `cancelContractAmendment` ve şemaları) ve `lib/contract-status.ts` (`contractStatus`, `isContractInForce`, `contractPlanLines`, etiketler). Sözleşme kaydı isteğe bağlı `signatory`, `approval`, `revision`, `amendsContractId`, `amendmentReason`, `proposedPlan`, `cancelledAt` alanlarını taşır. Yeni yazma eylemleri `contract.sign` (yönetici), `contract.approve` (yönetici, ön büro, ödeyici veli) ve `contract.amend` (yönetici, ön büro); modül `finance`.
- İndirim hesabı `discountLines` olarak ayrıldı ve vade hesabı `installmentDueDate` olarak dışa açıldı (`lib/enrollment.ts`); kesin kayıt davranışı değişmedi.
- Ayrılış hesabı yürürlükteki sözleşmeyi seçer: onaylanmamış ya da iptal edilmiş ek protokol ve yerini ek protokole bırakan sürüm taban olmaz (`lib/withdrawals.ts`, `invoicesOf` dışa açıldı).
