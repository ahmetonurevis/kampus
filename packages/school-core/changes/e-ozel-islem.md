---
etki: minor
---

- e-Özel işlem listesi kuralı eklendi (IST-085, DOM-KAY-015): `lib/finance-e-ozel.ts` kursiyer, ücret/dekont, devamsızlık ve kurs sonu satırlarını kurar, süzer ve formül kaçışlı CSV yazar; işaret kuralı `planEOzelMark` mükerrer işareti ve işlenmemiş satırın geri alınmasını 409 ile reddeder. Kimlik numarası yalnız maskeli çıkar.
