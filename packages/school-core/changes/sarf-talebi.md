---
etki: minor
---

- Sarf malzeme talebi kuralı eklendi (`lib/finance-supply-requests.ts`, DOM-FIN-091; ON-233): personel (öğretmen dahil) stok kartlarından miktar, gerekçe ve istenen günle talep açar (`planSupplyRequest`); yönetici onaylar ya da reddeder, talep eden onaydan önce iptal eder. Onaylı talep depodan karşılanır (`planSupplyFulfillment`; stok yetmezse karşılanabilen miktar, kalan için kısmi kapatma), kalan satın alma talebine kart bağıyla dönüştürülür (`planSupplyPurchaseConversion`). Kapsam: yönetici ve ön büro bütün talepleri, diğer personel yalnız kendi talebini görür (`canViewSupplyRequest`).
- Stok hareketine `supply` türü eklendi (`lib/finance-inventory.ts`, DOM-FIN-078): sarf talebi karşılama çıkışı; hareket listesinden iptal edilmez (`stock_movement_from_supply`).
