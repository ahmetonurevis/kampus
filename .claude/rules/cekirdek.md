---
paths:
  - 'packages/school-core/**'
---

# school-core kuralları

- Saf modül: Vue, React, DOM (`window`, `document`, `localStorage`), React Native, Node'a özgü modüller (`node:fs` vb.) ve veritabanı içe aktarılmaz. Web, mobil ve API aynı dosyayı çalıştırır.
- Dışa aktarım `package.json` içindeki `"./*": "./src/*"` ile dosya yolu üzerindendir (`@kampus/school-core/lib/x.ts`). Yeni kod core'u doğrudan içe aktarır; Vue uygulamasındaki `export *` aracı dosyalar yalnız eski kod içindir.
- İşlemler saf fonksiyondur: state ve parametre alır, Zod ile doğrular, ya hepsini değiştirir ya hiçbirini. Zaman gerekiyorsa `now` parametresi alır; testler gerçek saate bağlanmaz.
- Hesaplanabilen değer saklanmaz (hedef ilerlemesi, quiz puanı, rubrik toplamı).
- Rol kapsamı core'da çözülür: öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli kendi çocukları. Rehberlik iç notları veli/öğrenciye dönmez. API bu fonksiyonları kullanır; kapsamı ikinci kez elle yazmaz.
- Büyük listelerde satır başına tam tarama yapılmaz; `studentId` gibi anahtarlarla `Map` indeksi bir kez kurulur.
- Örnek veri deterministiktir: kimlikler sabit, tarihler başlangıç gününe göre üretilir. Mevcut kimlik değiştirilmez.
- Davranış değişikliği `package.json` sürümünü (semver) ve `CHANGELOG.md`'yi günceller; tüketicilerdeki `workspace:x.y.z` sabitlemesi aynı committe güncellenir.
- Her yeni kural birim testiyle gelir: başarılı yol, doğrulama hatasında kaydın değişmemesi, mükerrer işlem, her rolün kapsamı, modül kapalıyken ret.
