---
etki: patch
---

- `invoices.fee_kind` artık veritabanı kısıtıyla (`invoices_fee_kind_check`, migration 0072) core `FEE_ITEM_KINDS` anahtarlarından biri ya da boştur (ON-316, DOM-FIN-004). Taksit deposu şeması da aynı listeyi ister: etiketli ya da bilinmeyen kalem türü taşıyan eski `records` kaydı aynaya girmez, işlemi durdurmaz (046a şema uyumsuzluğu olarak sayılır). Core bugün yalnız anahtar yazdığı için ayna eşlemesi gerekmedi; uç ve yanıt değişmedi.
