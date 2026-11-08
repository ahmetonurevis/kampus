---
etki: minor
---

- Kitap ve materyal seti dağıtımı kuralları eklendi (ON-232; DOM-FIN-080): `lib/finance-material-sets.ts` set tanımı (ad, eğitim yılı, okulda sınıf düzeyi ya da dil okulunda kur hedefi, stok kartı ve adetlerden 1–30 kalem; ad yıl içinde tekil, teslimi başlamış setin yılı ve hedefi kilitli), öğrenciye teslim (öğrencinin kendisi, kayıtlı veli ya da adı yazılan kişi; teslim günü; kâğıt imza işareti; mükerrer teslim reddi; kısıtlı veli reddi), teslim iptali, imzanın sonradan işlenmesi, rol eylemleri (`materialSetActions`) ve öğrenci listesi CSV'si (`materialSetStudentsCsv`).
- `lib/finance-inventory.ts` hareket türlerine `delivery` (materyal seti teslimi çıkışı) eklendi; bu çıkış hareket listesinden iptal edilmez (422 `stock_movement_from_delivery`). Birden çok kalemin aynı depodan aynı gün çıkışı için `planStockIssueLines` eklendi (K-181 denetimi kalem başına).
