---
etki: minor
---

- Stok kartına isteğe bağlı barkod eklendi (`stockItemSchema.barcode`, DOM-FIN-077, K-284): boşluklar atılır, büyük harfe çevrilir; 8 ve 13 haneli sayısal kodda EAN sağlama basamağı denetlenir (`isValidEanCheckDigit`), barkod kurumda tekildir ve başka kartın koduyla çakışamaz (`stock_item_barcode_exists`). Stok sayımında okunan kod önce barkodla, sonra kart koduyla eşleşir (`findStockItemByScan`, K-229).
- Stok sayımında okutma geri alma eklendi (DOM-FIN-081, K-285): `STOCK_COUNT_ENTRY_KINDS`, `countedStateFromEntries`, `planStockCountScanUndo` ve `canUndoStockCountEntry`; `planStockCountScan` sonucu eklenen miktarı (`scannedQuantity`) da taşır. Demirbaş sayımında okutma geri alma eklendi (`planFixedAssetCountScanUndo`, DOM-FIN-087, K-286).
