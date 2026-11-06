---
etki: minor
---

- Ayrılışta bütün yürürlükteki sözleşmeler iade ve borç hesabına alındı (K-06, DOM-FIN-040, ON-296): paket satışı kullanılan saatle, öğrenim sözleşmesi girilen birimle hesaplanır, iade ve borç tek bakiyede netleşir. `quoteWithdrawal` dökümüne sözleşme başına `contracts` satırları eklendi; üst tutarlar bu satırların toplamıdır, tek sözleşmeli öğrencide sonuç değişmedi. Ek protokol zinciri tek sözleşme sayılır, planlanmış yenileme ve geçen yılın öğrenim sözleşmesi hesaba girmez. Kalan paket saati ayrılışta `returnedHours` ile bildirilir. `planRefundPayment` öteki sözleşmelerin ödeyicilerini de kabul eder (`otherPayerNames`).
