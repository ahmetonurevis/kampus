---
etki: minor
---

- Yenileme (`POST /api/v1/finance/renewals`, `/quote`, `/bulk-preview`, `/bulk-plan`), kesin kayıt ve sözleşme ek protokolü kardeş indiriminde velinin öteki öğrencilerinin sözleşmelerini yükledi: ilk çocuk artık indirim alamaz, kardeşin aynı eğitim yılında aktif kaydı yoksa 422 `sibling_discount_ineligible` döner (DOM-FIN-022, K-22; ON-301). Uç şeması değişmedi.
