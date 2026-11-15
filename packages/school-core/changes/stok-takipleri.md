---
etki: minor
---

- Stok kartına isteğe bağlı barkod eklendi (`stockItemSchema.barcode`, DOM-FIN-077, K-284): boşluklar atılır, büyük harfe çevrilir; 8 ve 13 haneli sayısal kodda EAN sağlama basamağı denetlenir (`isValidEanCheckDigit`), barkod kurumda tekildir ve başka kartın koduyla çakışamaz (`stock_item_barcode_exists`). Stok sayımında okunan kod önce barkodla, sonra kart koduyla eşleşir (`findStockItemByScan`, K-229).
