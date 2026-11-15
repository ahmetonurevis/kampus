---
etki: minor
---

- Satın alma talebinin kademeli onayı eklendi (`lib/finance-purchase-approvals.ts`, DOM-FIN-071, ON-223): kurum ayarı olarak 1–5 kademe eşiği (`purchaseApprovalSettingsSchema`; ilk kademe 0'dan başlar, alt sınırlar kesin artar, onaylayan herhangi bir yönetici ya da adlandırılmış yönetici), tutardan gereken kademelerin hesabı (`requiredApprovalSteps`), sıradaki kademe ve karar hakkı (`currentApprovalStep`, `assertApprovalTurn`, `canDecideApprovalStep`, `planApprovalDecision`): talep eden karar veremez, aynı kişi iki kademeye karar veremez, sonraki kademede adlandırılan kişi önceki rol kademesine karar veremez, ret talebi reddeder. Ayar boşsa tek adımlı yönetici onayı (K-129) sürer.
- `planPurchaseRequestWithdraw` ve `withdrawPurchaseRequestSchema` eklendi: gönderilmiş talep kararı verilmeden taslağa geri çekilir (K-261). `purchaseRequestActions` isteğe bağlı üçüncü parametre olarak talebin kademelerini alır ve `withdraw` alanını döndürür; kademeli talepte `decide` yalnız sıradaki onaylayana açıktır.
