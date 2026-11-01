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
- İki geliştiricili entegrasyon dalında dal adı, birleştirme ve sürüm kuralları §7'dedir.

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

## 7. İki geliştirici

İki geliştirici (Oğuzhan Demirci, Ahmet Onur Evis) Claude Code ile paralel çalışır. İlke: **izin yok, görünürlük var.** Kendi alanında herkes sormadan yazar, birleştirir, gönderir; iş issue'larla görünür tutulur. Yalnız sahiplik/kural değişikliği (bu bölüm, `alanlar.json`) ve ürün, hukuk, maliyet kararları birlikte alınır. Hook'lar (`alan-koruma`, `push-kontrol`) insan onayı istemeden otomatik denetler. Habersiz paralel iş migration numarası, core sürümü ve ekran çakışmaları doğurduğu için bu bölüm §1 ve §3'ün entegrasyon dalı (`feature/platform-gecisi`) için yerini alır. Zorunlu özet kök `CLAUDE.md`'de, ajan kuralı `.claude/rules/ortak-calisma.md`'de, alan haritası `.claude/alanlar.json`'dadır.

### 7.1 Alanlar

- **Onur:** kayıt (aday/CRM, kesin kayıt, öğrenci kimliği, yenileme) ve finans (tarife, tahsilat, fatura/taksit/sözleşme, ayrılış/iade, muhasebe, banka hesabı). `DOM-KAY` ve `DOM-FIN` kimlikleri onundur.
- **Oğuzhan:** geri kalan her şey; platform altyapısı (kimlik, rol/kapsam, bildirim, dosya, PDF, KVKK, tasarım sistemi, kabuk, mobil) dahil. Haritada sahibi tanımlanmamış her yol Oğuzhan'ındır.
- **Ortak sıcak dosyalar** (`alanlar.json` `shared`): school-core `domain`/`authorize`/`scope`/`school-workflows`, `modules/*`, `data/seed.ts`, `apps/api/src/app.ts`, `drizzle/**`, üretilen `openapi.json`/`schema.d.ts`, `page-registry`, `page-coverage`, `commands.test.ts`, README, CHANGELOG'lar, `package.json`'lar, lockfile ve Claude/mühendislik ayarları.
- `alan-koruma` hook'u diğer sahibin dosyasına `Edit`/`Write`'ı engeller, ortak dosyada hatırlatır. Kullanıcı `git config kampus.sahip onur|oguzhan` ile tanımlanır (yoksa `user.name`'den çıkarılır). Harita sınaması: `git ls-files | node .claude/hooks/alan-koruma.ts --classify`.

### 7.2 Dal ve iş kaydı

- Dal `onur/<konu>` veya `oguzhan/<konu>` (§1 ad kuralları geçerli), güncel `origin/feature/platform-gecisi`'nden açılır, kısa ömürlüdür. Oturum başında `git fetch` ve `git merge origin/feature/platform-gecisi` yapılır (oturum hook'u geride kalındığını söyler).
- İş başlamadan `gh issue list --state open` ile çakışan iş aranır; aynı dosya veya migration'a dokunan açık iş varsa durulur, kullanıcıya sorulur.
- Issue içeriği: sahip etiketi (`sahip:onur`/`sahip:oguzhan`), alan, dokunulacak dosyalar, ortak dosyada blok dışına çıkılıyorsa `ortak-dosya`, migration gerekiyorsa `migration` etiketi ve başlıkta numara, sürüyorsa `durum:devam`. Hata kaydı `bug` etiketi alır. Yeni etiket açılmaz.
- Commit gövdesi veya merge mesajı issue'yu `#<no>` ile anar; issue birleştirmede kapanır.
- Diğer alanda bir şey gerekirse alan sahibinin `sahip:` etiketiyle **iş isteği** issue'su açılır (izin isteği değildir): gerekçe, istenen davranış, etkilenen dosyalar. Bu arada kendi taraf geçici veriyle (sabit, taslak arayüz) yazılır ve iş beklemez. Kullanıcı karşı alandaki bir dosyayı kendisi değiştirmek isterse yolu `.claude/alan-izni.local` dosyasına (git'e girmez; satır başına yol veya glob) ekler; değişiklik issue'da görünür kılınır.
- Entegrasyonu kıran hatayı kıran düzeltir ya da kendi birleştirmesini geri alır (`git revert -m 1 <merge>`; geçmiş yeniden yazılmaz).

### 7.3 Entegrasyona birleştirme

1. `git fetch origin` ve `git merge origin/feature/platform-gecisi` (dal güncellenir; rebase yok).
2. Hızlı testler: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @kampus/api test`.
3. Çakışma ölçümü: `git merge-tree --write-tree origin/feature/platform-gecisi HEAD`; çakışma çıkarsa önce dalda çözülür.
4. Entegrasyon dalında `git merge --no-ff <dal>`; mesaj issue'yu anar. Ardından push.
5. Push reddedilirse: fetch, merge, testler, yeniden push. Birleşen dal yerelde ve uzakta silinir.

Yasak: force push (`--force`, `-f`, `--force-with-lease`, `+refspec`), gönderilmiş commit'te amend/rebase/reset, `main`'e push. `push-kontrol` hook'u ve `.claude/settings.json` izin listesi bunları engeller; entegrasyon dalına push'ta güncel `origin/feature/platform-gecisi`'nin atası olmayı ve migration numaralarının tekilliğini de denetler.

### 7.4 Migration

- Numara issue başlığına yazılır ve kullanılır ("… (migration 0016)", `migration` etiketi); onay beklenmez. Kesin numarayı entegrasyona giriş sırası belirler.
- Çakışmada **ikinci giren** kendi migration'ını (SQL, snapshot ve `_journal.json` kaydı) siler, güncel entegrasyonu birleştirir ve `pnpm --filter @kampus/api db:generate --name <ad>` ile yeniden üretir. Diğer geliştiricinin migration'ı değiştirilmez.
- Snapshot zinciri korunur (her snapshot `prevId` ile bir öncekine bağlanır); birleştirmeden sonra `db:generate` boş çıkmalıdır.
- `apps/api/drizzle/*.sql` içinde aynı numaralı iki dosya entegrasyona giremez; `_journal.json` kayıt sayısı `.sql` sayısıyla eşit olmalıdır.

### 7.5 core sürümü ve CHANGELOG

- Dallar `package.json` sürümü vermez. Değişiklik CHANGELOG'da en üstte `## Yayımlanmamış (<konu>)` başlığına yazılır.
- Sürüm entegrasyona girerken verilir: birleştiren, başlığı sıradaki sürüme (§4) çevirir, `package.json`, tüketici sabitlemeleri (§6) ve lockfile'ı aynı committe günceller.

### 7.6 Üretilen ve ortak dosyalar

- `apps/api/openapi.json` ve `packages/api-client/src/schema.d.ts` elle birleştirilmez: çakışmada iki dalın kodu birleştirildikten sonra `pnpm --filter @kampus/api openapi` ve `pnpm --filter @kampus/api-client generate` ile yeniden üretilir.
- README test sayıları yalnız tam doğrulamadan (dogrula merdiveni) sonra güncellenir; dallar sayıları değiştirmez.
- Blok kuralı: `page-registry.tsx`, `page-coverage.ts`, `apps/api/test/commands.test.ts` envanteri ve `apps/api/src/app.ts` route kayıtlarında her sahip kendi bloğuna yazar (blok başında `// Onur: kayıt ve finans` gibi yorum). Başkasının satırı yeniden sıralanmaz ve biçimlendirilmez; yeni satır bloğun sonuna eklenir. Blok dışına çıkmak gerekirse çıkılır ve issue'ya `ortak-dosya` etiketi konur; beklenmez.
- Bağımlılık eklemek serbesttir (ölçütler [kod-yazim.md](kod-yazim.md#8-bağımlılık-ekleme-politikası) ve `.claude/rules/bagimliliklar.md`); issue'nun dosya listesinde görünür. `pnpm-lock.yaml` çakışması elle çözülmez: `package.json` birleştirilir, `pnpm install` ile lockfile yeniden üretilir.

### 7.7 Kimlik aralıkları

- ADR numaraları entegrasyona giriş sırasıyla verilir; sıradaki ADR **0007**. Dalda yazılan ADR numarası issue başlığına yazılır ve kullanılır.
- Domain kural kimlikleri: `DOM-KAY-*` ve `DOM-FIN-*` Onur'undur. `yetki-ve-kapsam.md` (`DOM-YTK`) için Oğuzhan 055–079, Onur 080–099 aralığını kullanır. Diğer domain belgelerinde yeni kimlik alan sahibinindir; ortak belgede aralık issue'da ayrılır.
