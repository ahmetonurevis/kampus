---
etki: patch
---

- Yıl sonu mutabakatı birden çok sözleşmeli ayrılışta ayrılış düzeltmesini doğru hesaplar (ON-093; DOM-FIN-056, K-06): mahsup edilen alacak yalnız kaydın sözleşmesinin değil, dökümdeki bütün sözleşmelerin ödenmiş taksitlerini düşer. `ReconciliationWithdrawal.breakdown` isteğe bağlı `contracts` alır.
