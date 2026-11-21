---
etki: minor
---

- Satın alma talebi kalemi isteğe bağlı stok kartına bağlanır (ON-339; DOM-FIN-071, DOM-FIN-079): `purchaseRequestItemSchema` `stockItemId` alanı (varsayılan `null`), `assertPurchaseStockLinks` (bilinmeyen kart 400 alan hatası, pasif kart ve birim farkı 422; K-221). `stockPurchaseDraft` kalemleri kartına bağlı üretir (`StockSuggestionLine.id`); açık talep tanımı `OPEN_PURCHASE_REQUEST_STATUSES` ve mükerrer talep uyarısı `openRequestWarning` (K-222).
