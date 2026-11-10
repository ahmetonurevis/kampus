---
etki: minor
---

- Satın alma talebi kalemine isteğe bağlı `stockItemId` (ON-339, K-221; migration 0089 `purchase_request_stock_link`): kart yalnız etkin kurumda aranır, başka kurumun kartı 400 `items.<n>.stockItemId`. Talep, sipariş ve mal kabul panosu kalemleri `stockItem` (`id`, `code`, `name`) döner; bağ sipariş açılışında `purchase_order_items.stock_item_id`'ye kopyalanır (K-223). Kritik stok satırları `openRequestQuantity` ve `openRequestCount` taşır (K-222).
