# Git ve sürüm

## 1. Dal adları

| Önek       | Ne için                                                               | Örnek                         |
| ---------- | --------------------------------------------------------------------- | ----------------------------- |
| `feature/` | Yeni özellik, modül, kullanıcıya görünen değişiklik                   | `feature/okuma-anlama-modulu` |
| `fix/`     | Hata düzeltmesi                                                       | `fix/veli-etut-kapsami`       |
| `docs/`    | Yalnız doküman                                                        | `docs/muhendislik-kurallari`  |
| `chore/`   | Araç zinciri, bağımlılık, CI, davranış değiştirmeyen taşıma/düzenleme | `chore/ts-arac-zinciri`       |

- Küçük harf, kebab-case, Türkçe karakter yok (`ı → i`, `ş → s`, `ğ → g`, `ü → u`, `ö → o`, `ç → c`), en fazla 40 karakter.
- Bir dal tek konudur; ana daldan (`main`) açılır ve kısa ömürlüdür (hedef: bir haftadan kısa).
- `main`'e doğrudan push ve force push yoktur.

## 2. Commit kuralları

- Başlık Türkçe, emir kipinde, en fazla 72 karakter, sonunda nokta yok, önek (`feat:` vb.) yok:
  - "Hedef ve gelişim planı modülünü ekle"
  - "Veli etüt listesini seçili çocuğa daralt"
  - "school-core paketini TypeScript'e taşı"
- Gövde (gerekiyorsa) boş satırdan sonra: **neden** ve **etki**; ne yapıldığı diff'ten okunur. Satırlar 72 karakterde kırılır.
- Bir commit tek mantıksal değişikliktir:
  - Davranış değişikliği ve testi aynı committe.
  - Şema migration'ı ve onu kullanan kod aynı committe.
  - Yeniden düzenleme (refactor) ve TypeScript taşıması davranış değişikliğinden ayrı committe.
  - Biçim düzeltmesi ayrı committe (veya hiç; Prettier hook'u zaten düzeltir).
- **Her commit yeşildir:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, ilgili testler geçer. `git bisect` her committe çalışabilmelidir.
- Yeni bağımlılık gerekçesi gövdededir ([kod-yazim.md](kod-yazim.md#8-bağımlılık-ekleme-politikası)).
- Yapay zekâ yardımıyla yazılan commit gövdesi sonunda `Co-Authored-By:` satırı taşır.
- Sır, `.env`, imzalama anahtarı, APK, build çıktısı commit edilmez.

```
Veli etüt listesini seçili çocuğa daralt

Veli iki çocuk arasında geçince önceki çocuğun gelecek etütleri
listede kalıyordu. Kapsam artık school-core etüt kapsamından gelir;
mobil ve web aynı fonksiyonu kullanır.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## 3. Birleştirme

- Her değişiklik PR ile `main`'e girer. Koşullar: CI yeşil, en az bir inceleme, çözülmemiş yorum yok, dal `main`'in güncel hâli üzerine alınmış (rebase).
- İnsan incelemesi zorunlu alanlar: kimlik doğrulama, yetki ve kiracı izolasyonu, migration, kişisel veri alanı ekleme, ödeme, bağımlılık ekleme. Diğerlerinde `inceleyici` ajanının incelemesi ilk geçiştir, onay insandadır.
- Geçmiş doğrusaldır. Varsayılan **rebase ile birleştirme**: düzenli, her biri yeşil commitler korunur. Dalda düzeltme gürültüsü (`fixup!`, "testi düzelt") varsa birleştirmeden önce `git rebase -i --autosquash main` ile toplanır; toplanamıyorsa **squash** kullanılır ve başlık bu belgedeki kurala uyar.
- Merge commit kullanılmaz.
- PR açıklaması: ne/neden, etkilenen paketler, doğrulama sonucu sayılarla ("lint temiz, 80/80 birim, e2e 60/60"), ekran değiştiyse ekran görüntüsü ve erişilebilirlik kontrol listesi.

## 4. Sürümleme (semver)

Her paket ve uygulama kendi sürümünü `package.json`'da taşır.

| Ne                                                   | MAJOR                                                                    | MINOR                                          | PATCH                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| `packages/*` (school-core, api-client, react-shared) | Dışa aktarılan fonksiyon/tip/şema kırıcı değişti, snapshot uyumu bozuldu | Yeni dışa aktarım, yeni kural, yeni koleksiyon | Davranışı düzelten hata giderimi |
| `apps/api`                                           | `/api/vN` ana sürümü değişti                                             | Yeni uç veya alan                              | Hata giderimi                    |
| `apps/mobile`, `apps/web-react`                      | Kullanıcı verisi/oturum uyumsuz değişti                                  | Yeni modül veya görünür özellik                | Hata giderimi                    |

- Davranış değişikliği sürümü ve `CHANGELOG.md`'yi **aynı committe** günceller (school-core kuralı). Bir dal bir düzeyi en fazla bir kez artırır: dalın ilk MINOR değişikliği `1.3.0 → 1.4.0` yapar, sonraki commitler aynı `## 1.4.0` başlığına satır ekler.
- Yalnız iç düzenleme (davranışı değiştirmeyen taşıma, test, doküman) sürüm artırmaz.
- Mobil: `version` semver, Android `versionCode` her teslim edilen APK'da +1 (`app.json`). Sürüm notu `docs/mobile-release.md`.
- Sürüm etiketi teslimde konur: `<paket>@<sürüm>` (ör. `mobile@1.4.0`, `school-core@1.3.0`).

## 5. CHANGELOG

- Her yayımlanan paket ve uygulama kökünde `CHANGELOG.md` bulunur; mevcut biçim korunur:

```md
# Değişiklikler

## 1.4.0

- Okuma-anlama modülü eklendi: … (kullanıcıya ve tüketiciye etkisi)
- `saveTeacher` isteğe bağlı `now` parametresi aldı; varsayılan davranış değişmedi.
- Tüketiciler `workspace:1.4.0` sürümüne sabitlendi.
```

- En yeni sürüm en üsttedir. Satırlar Türkçe, geçmiş zaman edilgen ("eklendi", "düzeltildi"); tüketicinin yapması gereken bir şey varsa açıkça yazılır.
- Kırıcı değişiklik satırı "**Kırıcı:**" ile başlar ve geçiş adımını verir.

## 6. `workspace:` sabitlemeleri

- İç bağımlılıklar tam sürümle sabitlenir: `"@kampus/school-core": "workspace:1.3.0"`. `workspace:*` ve `workspace:^` kullanılmaz; tüketicinin hangi sürüme göre test edildiği diff'te görünür.
- Paket sürümü artınca bütün tüketicilerin sabitlemesi, `pnpm-lock.yaml` ve tüketici CHANGELOG notu ("Tüketiciler `workspace:1.4.0` sürümüne sabitlendi.") **aynı committe** güncellenir. Eşleşmeyen sabitleme `pnpm install --frozen-lockfile`'ı kırar; bu bilinçli bir kontroldür.
- Tüketici listesi: `grep -rn '"@kampus/<paket>"' apps/*/package.json packages/*/package.json`.
- Yeni iç paket `@kampus/<ad>` adını, `0.1.0` sürümünü ve `"private": true` alanını alır.
