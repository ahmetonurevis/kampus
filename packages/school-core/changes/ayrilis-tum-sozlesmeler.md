---
etki: minor
---

- Ayrılışta bütün yürürlükteki sözleşmeler iade ve borç hesabına alındı (K-06, DOM-FIN-040, ON-296): paket satışı kullanılan saatle, öğrenim sözleşmesi girilen birimle hesaplanır, iade ve borç tek bakiyede netleşir. `quoteWithdrawal` dökümüne sözleşme başına `contracts` satırları eklendi; üst tutarlar bu satırların toplamıdır, tek sözleşmeli öğrencide sonuç değişmedi. Ek protokol zinciri tek sözleşme sayılır, planlanmış yenileme ve geçen yılın öğrenim sözleşmesi hesaba girmez. Kalan paket saati ayrılışta `returnedHours` ile bildirilir. `planRefundPayment` öteki sözleşmelerin ödeyicilerini de kabul eder (`otherPayerNames`).
- Ayrılışta ödeyiciler farklı ve iade varken yöneticinin kararı zorunlu kılındı (K-12, DOM-FIN-040, ON-296): `quoteWithdrawal` `payersDiffer` ve `payers` döner, `withdrawStudentSchema` `payerDecision` alır; karar yoksa `withdrawal_payer_decision_required`, hesap dışı ödeyicide `withdrawal_payer_invalid`. Hesap değişmez. İade yalnız seçilen ödeyiciye yazılır (`refundPayerName`); `planRefundPayment`'taki `otherPayerNames` kaldırıldı.
