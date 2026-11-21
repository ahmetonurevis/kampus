---
etki: minor
---

- Laboratuvar kimyasal envanteri kuralı eklendi (`lib/finance-chemicals.ts`, DOM-FIN-090): stok kartına GHS01–GHS09 piktogramları, sinyal kelimesi (Tehlike/Dikkat), CAS numarası (biçim ve sağlama basamağı, `isValidCasNumber`), depolama sınıfı, uyumsuzluk notu ve GBF bağlantısı, belge numarası ve revizyon günüyle kimyasal bilgisi (`chemicalProfileSchema`, `planChemicalProfile`, `planChemicalProfileUpdate`); partilerin kalan miktarı hareketlerden en yakın son kullanma önce (FEFO) düşülerek hesaplanır (`chemicalLotBalances`); son kullanma durumu (`chemicalExpiry`, 30 gün uyarı), depo × kimyasal envanter satırları ve CSV'si (`chemicalInventoryRows`, `chemicalInventoryCsv`).
- Stok girişi şemasına isteğe bağlı `lotNumber` ve `expiryDate` eklendi (birlikte verilir); `planStockEntry` bağlamdaki `chemicalItemIds` kartları için parti ister (`stock_lot_required`), kimyasal olmayan kartta partiyi reddeder (`stock_lot_not_allowed`). Bağlamı vermeyen çağrıların davranışı değişmedi.
