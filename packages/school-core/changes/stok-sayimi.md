---
etki: minor
---

- Stok sayımı ve fark raporu kuralları eklendi (ON-231; DOM-FIN-081): `lib/finance-stock-counts.ts` sayım başlatma (depodaki miktarların anlık görüntüsü, depoda tek açık sayım), kart kodu okutma (barkod okuyucu kodu klavye gibi yazar; 1 ya da girilen miktar eklenir) ve elle miktar, sayım sırasındaki hareketleri kart sayılana kadar beklenene katan fark raporu (`stockCountReport`, `movementDuringCount`), tamamlama planı (fazla ve eksik düzeltmesi; eksiye düşürecek eksik reddi), iptal, rol eylemleri (`stockCountActions`) ve fark raporu CSV'si (`stockCountReportCsv`).
- `lib/finance-inventory.ts` hareket türlerine `adjustment_in` ve `adjustment_out` (sayım düzeltmesi) eklendi; bu hareketler iptal edilmez (422 `stock_movement_from_count`). Miktarı artıran türler `STOCK_INBOUND_TYPES` olarak dışa açıldı; `assertItem` ve `assertWarehouse` dışa aktarıldı.
