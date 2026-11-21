---
etki: minor
---

- Kardeş indirimi ikinci ve sonraki çocuğa, yani ücreti düşük olana uygulandı (DOM-FIN-022; ON-109): `requireSiblingDiscountEligible` (`lib/enrollment.ts`) aynı veliye bağlı aktif çocukları son yürürlükteki sözleşmenin ilan ücretine göre sıralar, en yüksek ücretli (eşitse önce kaydolan) çocuğa indirim verilmez. Kesin kayıt, yenileme ve ek protokol aynı kuralı çağırır; ret kodu yine `sibling_discount_ineligible`.
