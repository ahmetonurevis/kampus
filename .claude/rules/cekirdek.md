---
paths:
  - 'packages/school-core/**'
---

# school-core kuralları

Ayrıntı: `docs/muhendislik/kod-yazim.md` (klasör yapısı, hata sınıfları), `docs/muhendislik/git-ve-surum.md` (sürüm).

- Saf modül: Vue, React, DOM (`window`, `document`, `localStorage`), React Native, Node'a özgü modüller (`node:fs` vb.) ve veritabanı içe aktarılmaz. Web, mobil ve API aynı dosyayı çalıştırır.
- Dışa aktarım `package.json` içindeki `"./*": "./src/*"` ile dosya yolu üzerindendir (`@kampus/school-core/lib/x.ts`). Yeni kod core'u doğrudan içe aktarır; Vue uygulamasındaki `export *` aracı dosyalar yalnız eski kod içindir.
- Klasörler: `data` (örnek veri), `lib` (kurallar, şemalar, kapsam, `errors.ts`), `modules` (kayıt), `content` (içerik havuzu: taksonomi, kaynak/sürüm, görünürlük, kopya; ADR 0004), `skills` (beceri görevleri: puan, deneme, süre, teslim, taslak). `content/` ve `skills/` State dışındadır: girdi servisin yüklediği satırlardır, fonksiyonlar saf ve `now` parametrelidir, rastgelelik de dışarıdan verilir. İşlem girdi şemaları API gövde şeması ve web/mobil form şeması (`zodResolver`) olarak da kullanılır.
- İşlemler saf fonksiyondur: state ve parametre alır, Zod ile doğrular, ya hepsini değiştirir ya hiçbirini. Zaman gerekiyorsa `now` parametresi alır; testler gerçek saate bağlanmaz.
- İş kuralı reddi `DomainError(code, mesaj, { kind, path })` ile; `code` İngilizce snake_case, mesaj Türkçe. Taşınan dosyada `throw new Error('…')` mesajı korunarak `DomainError`'a çevrilir.
- Hesaplanabilen değer saklanmaz (hedef ilerlemesi, quiz puanı, rubrik toplamı).
- Para tamsayı kuruş; tarih ISO UTC veya `YYYY-MM-DD`, gösterim Europe/Istanbul (`lib/format`).
- Rol kapsamı core'da çözülür (`lib/scope.ts` `scopeFor(source, actor)`, `Actor = { role, links }`): öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli bağlı çocukları. Rehberlik iç notunu yalnız rehberlik görevli öğretmen görür; denetim kaydına içerik değil alan adı yazılır. Koleksiyon → modül eşlemesi `modules/collection-modules.ts`, komut → modül/koleksiyon tablosu `modules/commands.ts` (`commandSpec`), yazma yetkisi `lib/authorize.ts` (`requireAuthorized`). API bu fonksiyonları kullanır; kapsamı ve yetkiyi ikinci kez elle yazmaz.
- Büyük listelerde satır başına tam tarama yapılmaz; `studentId` gibi anahtarlarla `Map` indeksi bir kez kurulur.
- Örnek veri deterministiktir: kimlikler sabit, tarihler başlangıç gününe göre üretilir. Mevcut kimlik değiştirilmez.
- Yeni kişisel alan şemada sınıfıyla işaretlenir (`// kvkk: K|Ç|Ö`).
- Davranış değişikliği `package.json` sürümünü (semver) ve `CHANGELOG.md`'yi günceller; tüketicilerdeki `workspace:x.y.z` sabitlemesi ve lockfile aynı committe güncellenir. Bir dal bir düzeyi bir kez artırır.
- Her yeni kural birim testiyle gelir: başarılı yol, doğrulama hatasında kaydın değişmemesi, mükerrer işlem, her rolün kapsamı, modül kapalıyken ret. Kapsam hedefi satır %90, dal %85.
