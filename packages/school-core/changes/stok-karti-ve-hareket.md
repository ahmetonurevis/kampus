---
etki: minor
---

- Stok kartı, depo ve stok hareketi kuralları eklendi (ON-228, ON-229; DOM-FIN-077, DOM-FIN-078): `lib/finance-inventory.ts` stok kartı (kod, ad, kategori, stoklanan birim, kritik seviye; kod tekilliği, hareketli kartta birim kilidi, stoklu kartı pasifleştirme reddi), kampüse bağlı depo (ad tekilliği, stoklu depoyu taşıma ve pasifleştirme reddi), elle giriş ve çıkış (sabit neden kümeleri), depolar arası transfer (iki hareket), gün sonu miktarı eksiye düşmeme denetimi (`availableOn`, `firstNegativeDay`), gerekçeli hareket iptali (transfer birlikte) ve mal kabulden depoya giriş planı (`planReceiptStockEntries`, `planReceiptStockCancel`).
- `lib/finance-purchase-receipts.ts` kabul şemasına isteğe bağlı `warehouseId` ve kalem başına `stockItemId` eklendi; kart seçilip depo seçilmezse şema reddeder (K-184).
