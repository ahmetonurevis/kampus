---
etki: patch
---

- React web taksit taahhütnamesinde "Tahsil edilen" ve "Kalan bakiye" sunucu bakiyesinden alındı (OG-990, #19; DOM-FIN-051): kısmi ödenen taksit de sayılır. Bakiye okunamazsa (rol ya da finans modülü kapalı) belge eskisi gibi yalnız tam kapanan taksitleri sayar. Core değişmedi.
