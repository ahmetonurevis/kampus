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

Her paket ve uygulama kendi sürümünü `package.json`'da taşır. Sürüm **yalnız teslimde** (etiketle birlikte) verilir; dallar ve entegrasyon dalı sürüm artırmaz. Paralel dallarda her sürüm artışı altı `package.json` ile lockfile'ı değiştirip çakışma çıkarıyordu.

| Ne                                                   | MAJOR                                                                    | MINOR                                          | PATCH                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| `packages/*` (school-core, api-client, react-shared) | Dışa aktarılan fonksiyon/tip/şema kırıcı değişti, snapshot uyumu bozuldu | Yeni dışa aktarım, yeni kural, yeni koleksiyon | Davranışı düzelten hata giderimi |
| `apps/api`                                           | `/api/vN` ana sürümü değişti                                             | Yeni uç veya alan                              | Hata giderimi                    |
| `apps/mobile`, `apps/web-react`                      | Kullanıcı verisi/oturum uyumsuz değişti                                  | Yeni modül veya görünür özellik                | Hata giderimi                    |

- Davranış değişikliği aynı committe bir değişiklik parçası yazar (§5); sürüm ve `CHANGELOG.md` dalda değişmez.
- Teslimde: parçalar okunur, en yüksek etki (MAJOR > MINOR > PATCH) sürümü belirler, `package.json` sürümü ve CHANGELOG tek committe güncellenir.
- Yalnız iç düzenleme (davranışı değiştirmeyen taşıma, test, doküman) parça yazmaz.
- Mobil: `version` semver, Android `versionCode` her teslim edilen APK'da +1 (`app.json`). Sürüm notu `docs/mobile-release.md`.
- Sürüm etiketi teslimde konur: `<paket>@<sürüm>` (ör. `mobile@1.4.0`, `school-core@1.3.0`).

## 5. CHANGELOG ve değişiklik parçaları

- Dalda her davranış değişikliği paketin `changes/` klasörüne tek, kısa bir parça dosyası ekler: `packages/school-core/changes/<konu>.md` (diğer paketlerde de `<paket>/changes/<konu>.md`). Her dal kendi dosyasını yazdığı için CHANGELOG çakışmaz.

```md
---
etki: minor
---

- Okuma-anlama modülü eklendi: … (kullanıcıya ve tüketiciye etkisi)
- `saveTeacher` isteğe bağlı `now` parametresi aldı; varsayılan davranış değişmedi.
```

- `etki`: `major`, `minor` veya `patch` (§4 tablosu). Satırlar Türkçe, geçmiş zaman edilgen ("eklendi", "düzeltildi"); tüketicinin yapması gereken bir şey varsa açıkça yazılır. Kırıcı değişiklik satırı "**Kırıcı:**" ile başlar ve geçiş adımını verir.
- Teslimde parçalar `CHANGELOG.md`'ye yeni `## x.y.z` başlığı altında derlenir (en yeni üstte, mevcut biçim) ve `changes/` klasörü boşaltılır (yalnız `README.md` kalır).

## 6. `workspace:` bağımlılıkları

- İç bağımlılıklar `workspace:*` ile bağlanır: `"@kampus/school-core": "workspace:*"`. Tüketici her zaman çalışma alanındaki güncel paketi kullanır; sürüm artışı tüketici `package.json`'larını ve lockfile'ı değiştirmez.
- Tüketici listesi: `grep -rn '"@kampus/<paket>"' apps/*/package.json packages/*/package.json`.
- Yeni iç paket `@kampus/<ad>` adını, `0.1.0` sürümünü ve `"private": true` alanını alır.

## 7. İki geliştirici

İki geliştirici (Oğuzhan Demirci, Ahmet Onur Evis) Claude Code ile paralel çalışır. İlke: **izin yok, görünürlük var; hız önce.** Kendi alanında herkes sormadan yazar, birleştirir, gönderir; iş görev tablolarında (`docs/is-bolumu/<sahip>.md`) görünür tutulur. Yalnız sahiplik/kural değişikliği (bu bölüm, `alanlar.json`) ve ürün, hukuk, maliyet kararları birlikte alınır. Hook'lar (`alan-koruma`, `push-kontrol`) insan onayı istemeden otomatik denetler. Bu bölüm §1 ve §3'ün entegrasyon dalı (`feature/platform-gecisi`) için yerini alır. Zorunlu özet kök `CLAUDE.md`'de, ajan kuralı `.claude/rules/ortak-calisma.md`'de, alan haritası `.claude/alanlar.json`'da, görev tabloları `docs/is-bolumu/`'dadır, ilk kurulum `docs/is-bolumu/ilk-kurulum.md`. Skill'ler: `is-baslat`, `entegre-et`.

### 7.1 Alanlar

- **Onur:** kayıt (aday/CRM, kesin kayıt, öğrenci kimliği, yenileme) ve finans (tarife, tahsilat, fatura/taksit/sözleşme, ayrılış/iade, muhasebe, banka hesabı). `DOM-KAY` ve `DOM-FIN` kimlikleri onundur.
- **Oğuzhan:** geri kalan her şey; platform altyapısı (kimlik, rol/kapsam, bildirim, dosya, PDF, KVKK, tasarım sistemi, kabuk, mobil) dahil. Haritada sahibi tanımlanmamış her yol Oğuzhan'ındır.
- **Ortak sıcak dosyalar** (`alanlar.json` `shared`): school-core `domain`/`authorize`/`scope`/`school-workflows`, `modules/*`, `data/seed.ts`, `apps/api/src/app.ts`, `drizzle/**`, üretilen `openapi.json`/`schema.d.ts`, `page-registry`, `page-coverage`, `commands.test.ts`, README, CHANGELOG'lar ve `changes/` parçaları, `package.json`'lar, lockfile, `docs/is-bolumu/README.md` ve Claude/mühendislik ayarları.
- Görev tabloları: `docs/is-bolumu/onur.md` ve `docs/is-bolumu/oguzhan.md` yalnız sahibince düzenlenir (§7.2a). Oturum hook'u (`session-context.sh` → `gorev-durumu.ts`) iki tabloyu `origin/feature/platform-gecisi`'nden okuyup özetler: kendi `çalışılıyor`, `revizyon`, `engelli` satırların ve sıradaki beş `bekliyor`, karşı tarafın `çalışılıyor` ve `revizyon` satırları ile bitti/toplam sayısı, sana açılmış iş istekleri.
- `alan-koruma` hook'u diğer sahibin dosyasına `Edit`/`Write`'ı engeller, ortak dosyada hatırlatır. Kullanıcı `git config kampus.sahip onur|oguzhan` ile tanımlanır (yoksa `user.name`'den çıkarılır). Harita sınaması: `git ls-files | node .claude/hooks/alan-koruma.ts --classify`.

### 7.2 Dal ve iş kaydı

- Dal `onur/<konu>` veya `oguzhan/<konu>` (§1 ad kuralları geçerli), güncel `origin/feature/platform-gecisi`'nden açılır. Uzun yaşayan dal yoktur: küçük, mantıklı bir birim yeşil olunca hemen entegrasyona girer. Oturum başında `git fetch` ve `git merge origin/feature/platform-gecisi` yapılır (oturum hook'u geride kalındığını söyler).
- İş başlamadan karşı tablonun `çalışılıyor` satırlarına ve sahibe açılmış issue'lara bakılır; aynı dosya veya migration'a dokunan iş varsa durulur, kullanıcıya sorulur.
- Commit gövdesi veya merge mesajı görev ID'sini (`OG-012`, `ON-007`) anar; iş isteğinden gelen işte issue da `#<no>` ile anılır.
- **Issue yalnız iş isteği ve hata bildirimidir**, görev durumu taşımaz. Diğer alanda bir şey gerekirse oturum durmadan alan sahibinin etiketiyle iş isteği açar (izin isteği değildir): `gh issue create -R ahmetonurevis/kampus --label sahip:<karşı taraf>`; gerekçe, istenen davranış, etkilenen dosyalar, bağlı görev ID'si. Hata kaydı `bug`, migration isteyen `migration`, blok dışına çıkan ortak dosya işi `ortak-dosya` etiketi alır; yeni etiket açılmaz, `durum:devam` artık kullanılmaz. Kendi taraf geçici veriyle (sabit, taslak arayüz) yazılmaya devam eder. Entegrasyon dalı varsayılan dal olmadığından "Closes #n" işlemez; isteği bitiren `gh issue close <no>` ile kapatır. Kullanıcı karşı alandaki bir dosyayı kendisi değiştirmek isterse yolu `.claude/alan-izni.local` dosyasına (git'e girmez; satır başına yol veya glob) ekler; değişiklik issue'da görünür kılınır.

### 7.2a Görev tablosu ve durum

- Her dalga (D1–D9, Sonra) bir tablodur; D6–D9 küme alt başlıklarına bölünür: `ID | Görev | … | Durum | Dal / commit | Not` (`Boyut` S/M/L; ek sütun serbesttir, hook sütunları başlıktan okur). ID kalıcıdır (`OG-001`, `ON-001`); yeni görev dalga tablosunun sonuna dosyadaki en büyük numaradan sonrakiyle eklenir, numara yeniden verilmez, vazgeçilen görev `iptal` olur.
- Durum yalnız `bekliyor`, `çalışılıyor`, `revizyon` (bitmişti; inceleme, kullanıcı ya da karşı taraf düzeltme istedi; Not'a gerekçe ya da `#issue`), `engelli` (Not'a beklenen ID: "ON-014 bekleniyor"; o bitince `bekliyor`a döner), `bitti`, `iptal`.
- Başlarken (`is-baslat`) sıradaki `bekliyor` görev (önce dalga, sonra bağımlılık) `çalışılıyor` olur, Dal sütununa dal adı yazılır; bu tek satır güncel entegrasyon dalında küçük bir commit'tir ("Görev durumunu güncelle: OG-012 çalışılıyor") ve dal açılmadan gönderilir. Onur'un oturumu push'u kendisi yapar; Oğuzhan tarafında push'u kullanıcı yapar.
- Bitirirken (`entegre-et`) entegrasyona birleştirme commit'inin hemen arkasındaki commit satırı `bitti` yapar, Dal / commit sütununa birleştirmenin kısa hash'ini yazar.
- Migration ve ADR numarası görev satırının Not'una yazılır ve durum commit'iyle duyurulur.

### 7.3 Doğrulama ve entegrasyon (`entegre-et`)

- Push öncesi yalnız dokunulan paketlerin `format:check`, `lint`, `typecheck` ve ilgili birim/API testleri koşulur. Tam set ve e2e CI'dadır (`.github/workflows/checks.yml`, entegrasyon dalına push'ta). Yerelde tam e2e yalnız ekran/akış değiştiyse ya da CI kırmızıysa koşulur.
- Adımlar:
  1. `git fetch origin` ve `git merge origin/feature/platform-gecisi` (dal güncellenir; rebase yok).
  2. Çakışma çıkarsa üretilen dosyalar için `pnpm install && pnpm gen`; çakışma ölçümü için `git merge-tree --write-tree origin/feature/platform-gecisi HEAD`.
  3. Hızlı kontroller (yukarıdaki kademe).
  4. Entegrasyon dalında `git merge --no-ff <dal>`; mesaj görev ID'sini anar. Hemen arkasından görev satırı `bitti` ve birleştirme hash'i (§7.2a); push. İş bir iş isteğinden geldiyse `gh issue close <no>`.
  5. Push reddedilirse: fetch, merge, kontroller, yeniden push. Birleşen dal yerelde ve uzakta silinir.
- CI kırmızıysa kıran ilk iş olarak düzeltir ya da kendi birleştirmesini geri alır (`git revert -m 1 <merge>`; geçmiş yeniden yazılmaz).

Yasak: force push (`--force`, `-f`, `--force-with-lease`, `+refspec`), gönderilmiş commit'te amend/rebase/reset, `main`'e push. `push-kontrol` hook'u ve `.claude/settings.json` izin listesi bunları engeller; entegrasyon dalına push'ta güncel `origin/feature/platform-gecisi`'nin atası olmayı ve migration numaralarının tekilliğini de denetler.

### 7.4 Migration

- Numara görev satırının Not'una yazılır ve kullanılır ("migration 0023"); onay beklenmez. Kesin numarayı entegrasyona giriş sırası belirler.
- Çakışmada **ikinci giren** kendi migration'ını (SQL, snapshot ve `_journal.json` kaydı) siler, güncel entegrasyonu birleştirir ve `pnpm --filter @kampus/api db:generate --name <ad>` ile yeniden üretir. Diğer geliştiricinin migration'ı değiştirilmez.
- Snapshot zinciri korunur (her snapshot `prevId` ile bir öncekine bağlanır); birleştirmeden sonra `db:generate` boş çıkmalıdır.
- `apps/api/drizzle/*.sql` içinde aynı numaralı iki dosya entegrasyona giremez; `_journal.json` kayıt sayısı `.sql` sayısıyla eşit olmalıdır.

### 7.5 core sürümü ve CHANGELOG

- Dal ve entegrasyon sürüm vermez; davranış değişikliği `packages/school-core/changes/<konu>.md` parçasına yazılır (§5). Tüketiciler `workspace:*` olduğundan sürüm artışı dallarda dosya değiştirmez (§6).
- Teslimde parçalar CHANGELOG'a derlenir, sürüm (§4) verilir, `changes/` boşaltılır, etiket konur.

### 7.6 Üretilen ve ortak dosyalar

- `apps/api/openapi.json` ve `packages/api-client/src/schema.d.ts` elle birleştirilmez: iki dalın kodu birleştirildikten sonra `pnpm gen` (OpenAPI + api-client şeması) ile yeniden üretilir.
- README test sayıları dallarda ve entegrasyonda güncellenmez; yalnız teslimde tam doğrulamadan sonra. Ara dönemde CI yeşili esastır.
- Blok kuralı: `page-registry.tsx`, `page-coverage.ts`, `apps/api/test/commands.test.ts` envanteri ve `apps/api/src/app.ts` route kayıtlarında her sahip kendi bloğuna yazar (blok başında `// Onur: kayıt ve finans` gibi yorum). Başkasının satırı yeniden sıralanmaz ve biçimlendirilmez; yeni satır bloğun sonuna eklenir. Blok dışına çıkmak gerekirse çıkılır ve görev satırının Not'una "ortak dosya" yazılır; beklenmez.
- Bağımlılık eklemek serbesttir (ölçütler [kod-yazim.md](kod-yazim.md#8-bağımlılık-ekleme-politikası) ve `.claude/rules/bagimliliklar.md`); commit mesajında belirtilir. `pnpm-lock.yaml` çakışması elle çözülmez: `package.json` birleştirilir, `pnpm install` ile lockfile yeniden üretilir.

### 7.7 Kimlik aralıkları

- ADR numaraları entegrasyona giriş sırasıyla verilir; sıradaki ADR **0007**. Dalda yazılan ADR numarası görev satırının Not'una yazılır ve kullanılır.
- Domain kural kimlikleri: `DOM-KAY-*` ve `DOM-FIN-*` Onur'undur. `yetki-ve-kapsam.md` (`DOM-YTK`) için Oğuzhan 055–079, Onur 080–099 aralığını kullanır. Diğer domain belgelerinde yeni kimlik alan sahibinindir; ortak belgede aralık görev satırının Not'unda ayrılır.
