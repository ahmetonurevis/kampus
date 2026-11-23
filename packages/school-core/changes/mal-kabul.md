---
etki: minor
---

- Mal kabul kuralları eklendi (ON-226; DOM-FIN-074): `lib/finance-purchase-receipts.ts` gönderilmiş siparişe kalem bazında kabul şeması (kabul günü, teslim alan personel, muayene notu, kabul edilen ve gerekçeli reddedilen miktar), birden çok kısmi kabulde kalan miktar denetimi (`planPurchaseReceipt`, `receiptProgress`), kabul edilen toplamdan sipariş durumu (gönderildi, kısmen teslim, tamamlandı; `receivingStatus`), gerekçeli kabul iptali (`planPurchaseReceiptCancel`), kapalı bütçe dönemi denetimi ve gider gerçekleşeni satırları (kabul edilen × birim fiyat, KDV hariç, kabul gününde; `receiptExpenseActuals`).
- `lib/finance-purchase-requests.ts` `purchaseBudgetInfo` bütçe kalanında siparişin açık kısmını (`orderedCents`) ve kabul edilen kısmını (`receivedCents`, gerçekleşen) ayrı alır; kalan plan eksi taahhüt eksi gerçekleşendir (K-145, K-154). Uyarı metni taahhüt ve gerçekleşeni yazar.
