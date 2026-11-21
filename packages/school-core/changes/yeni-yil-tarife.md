---
etki: patch
---

- Taksit dağılımı sıfır tutarlı taksit üretmez (ON-092, DOM-FIN-011, IST-105): `installmentAmounts` kuruş taksit sayısından azsa `invalid_installment` ile reddeder. Önceden sıfır tutarlı taksit üretilir ve API'de veritabanı kısıtına (`invoices_amount_cents_check`) takılabilirdi; artık kural hatası (422) olarak döner, plan açılmaz.
