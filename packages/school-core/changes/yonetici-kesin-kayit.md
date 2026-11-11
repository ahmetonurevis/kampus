---
etki: patch
---

- Yönetici de kesin kayıt yapabilir (ON-102, #9; DOM-KAY-035): API'li yüzeylerde yönetici menüsüne Kayıt İşlemleri eklendi (`KAYIT & SATIŞ`, `apiOnly`; Vue demosunda yok) ve aday detayındaki "Kesin kayda dönüştür" düğmesi yöneticiye de açıldı; bağlantı oturumdaki rolün rotasına gider. Yetki kuralı (`prospect.enroll`) değişmedi.
