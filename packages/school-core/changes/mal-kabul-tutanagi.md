---
etki: minor
---

- Mal kabul tutanağı PDF'i eklendi (ON-337; DOM-FIN-074): kabul panosu yanıtı (`GET/POST /api/v1/finance/purchase-orders/:orderId/receipts…`) siparişin tedarikçi kopyasını (`order.supplier`; şahıs tedarikçide vergi dairesi ve TCKN boş, K-215), kabulün kayıt sırasını (`receipts[].sequence`, tutanak numarası `<sipariş no>-MK<sıra>`, K-216) ve satır başına sipariş miktarı, KDV hariç birim fiyat ve tutarı (`orderedQuantity`, `unitPriceCents`, `netCents`) taşır. Web kabul geçmişinde her kayıt için "Tutanak PDF" önizleme ve indirmesi verir; iptal edilmiş kabulün tutanağı "İPTAL" işaretlidir (K-217).
