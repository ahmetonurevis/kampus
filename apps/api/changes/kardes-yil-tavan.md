---
etki: patch
---

- Yenileme önizlemesi, planı, toplu önizleme ve yeni yıl listesi (`/api/v1/finance/renewals/quote`, `POST /renewals`, `/bulk-preview`, `/bulk-plan`, `/candidates`) kardeş indirimi seçilmese de velinin öteki öğrencilerinin sözleşmelerini yükledi: tavan istisnası (`ceiling.discountLoss`) kardeşin yenileme yılındaki kaydına bakar (DOM-FIN-022, DOM-FIN-023, K-22; ON-307). Uç şeması değişmedi.
