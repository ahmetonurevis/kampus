---
etki: minor
---

- e-Özel işlem listesi kuralı eklendi (IST-085, DOM-KAY-015): `lib/finance-e-ozel.ts` kursiyer, ücret/dekont, devamsızlık ve kurs sonu satırlarını kurar, süzer ve formül kaçışlı CSV yazar; işaret kuralı `planEOzelMark` mükerrer işareti ve işlenmemiş satırın geri alınmasını 409 ile reddeder. Kimlik numarası satırda ve dosyada yalnız maskeli çıkar.
- Düzeltme durumu eklendi: `recordStatus` (`pending`, `needs_correction`, `recorded`), `sourceRemoved`, `eOzelFingerprint`, `eOzelChangeNote`. Kaynağı sonradan değişen işaretli satır "e-Özel'de düzeltilmeli" olur; özet girdisi kişisel değer taşımaz, özet işlevi dışarıdan verilir (`EOzelDigest`). Kursiyer satırının kimliği iptalde değişmez, kur sonu satırı kayda bağlıdır. `planEOzelMark` kaynağı kalkmış satırın işaretini kaldırmayı 409 `e_ozel_source_removed` ile reddeder.
