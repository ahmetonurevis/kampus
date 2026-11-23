---
etki: patch
---

- React web taksit taahhütnamesinde "Tahsil edilen" ve "Kalan bakiye" sunucu bakiyesinden alındı (OG-990, #19; DOM-FIN-051): kısmi ödenen taksit de sayılır. Bakiye okunamazsa (rol ya da finans modülü kapalı) belge eskisi gibi yalnız tam kapanan taksitleri sayar. Core değişmedi.
- React web belge önizlemesine `student-statement` (Cari ekstre) türü eklendi (OG-991, #20; IST-107): belge API ekstresinden ve öğrenci kaydının adından üretilir, dosya adı `cari-ekstre-<öğrenci>.pdf` olarak kalır. Öğrenci adı okunamazsa başlık "—" yazar.
