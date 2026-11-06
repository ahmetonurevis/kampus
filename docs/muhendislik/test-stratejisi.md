# Test stratejisi

Amaç: iş kuralı, yetki ve kiracı izolasyonu hatası üretime çıkmasın; CI hızlı ve güvenilir kalsın. Araçlar: birim ve bütünleşik testlerde `node:test` + `node:assert/strict`, API'de `app.inject` + PGlite, uçtan uca testlerde Playwright.

## 1. Piramit

| Katman     | Pay (test sayısı) | Ne test edilir                                                             | Nerede                                   |
| ---------- | ----------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| Birim      | ~%70              | school-core işlemleri, kapsam, biçimleyiciler, api-client, saf yardımcılar | `tests/*.test.ts`, paket içi `*.test.ts` |
| Bütünleşik | ~%25              | API uçları (HTTP → servis → PGlite), migration'lar, yetki matrisi          | `apps/api/test/*.test.ts`                |
| Uçtan uca  | ~%5               | Rol bazlı ana akışlar, gezinme, erişilebilirlik, görsel bozulma            | `tests/e2e/*.spec.ts`                    |

Kurallar:

- Bir kural en alt katmanda test edilir. Hedef onayının doğrulaması birim testindedir; API testi yalnız HTTP eşlemesini, yetkiyi ve kalıcılığı doğrular; e2e yalnız akışın uçtan uca çalıştığını gösterir.
- React bileşen testi şimdilik yazılmaz: mantık hook'lara ve saf fonksiyonlara çıkarılıp birim testiyle, ekran davranışı e2e ile doğrulanır. Bileşen test aracı seçimi açık sorudur (README).
- Hata bulunduğunda önce hatayı yeniden üreten test yazılır, sonra düzeltme; ikisi aynı committe.

## 2. Kapsam hedefleri

Ölçüm: `node --test --experimental-test-coverage`. Eşikler `--test-coverage-lines` ve `--test-coverage-branches` ile CI'da uygulanır.

| Paket                   | Satır                       | Dal | Ek ölçüt                                                                     |
| ----------------------- | --------------------------- | --- | ---------------------------------------------------------------------------- |
| `packages/school-core`  | %90                         | %85 | Her işlem için başarı, doğrulama hatası, mükerrer, rol kapsamı, modül kapalı |
| `apps/api`              | %85                         | %80 | Her uç için 401/403/404/400/başarı ve kiracı izolasyonu (bkz. §5)            |
| `packages/api-client`   | %90                         | %85 | Yenileme, hata zarfı çözümleme, ağ hatası                                    |
| `packages/react-shared` | %80                         | %70 | Oturum ve sorgu hook'larının saf mantığı                                     |
| `apps/web-react`        | —                           | —   | Her modülün ana akışı en az bir e2e senaryosunda                             |
| `apps/mobile`           | `src/model`, `src/lib`: %80 | —   | Ekranlar `export:web` ve elle kontrol listesiyle                             |

- Başlangıçta mevcut kapsam ölçülür, eşik o değerin bir puan altına konur ve hedefe gelene kadar yalnız yükseltilir (cırcır). Eşik düşürmek gerekçeli ayrı commit ister.
- Kapsam amaç değil, alt sınırdır: davranış doğrulamayan (yalnız çağıran) test kapsam için yazılmaz.

## 3. Test verisi ve fabrikalar

- Zaman sabittir: `const now = '2026-10-06T10:00:00.000Z'`; school-core işlemleri `now` alır, API `buildApp({ clock: () => new Date(now) })` ile saat alır. `Date.now()` veya gerçek saate bağlı beklenti yok.
- Örnek veri: birim testinde `createSeed(new Date(now))`. Seed deterministiktir; mevcut kimlikler (`s1`, `goal-s1-math`) değiştirilmez.
- Testin kendi oluşturduğu kayıtlar test önekli kimlik alır (mevcut kalıp):

```ts
let sequence = 0
const id = (prefix: string) => `${prefix}-goal-test-${++sequence}`
```

- Fabrikalar varsayılanı geçerli bir nesne üretir, yalnız testin önemsediği alan değiştirilir:

```ts
// tests/support/factories.ts
export function makeGoalInput(overrides: Partial<GoalInput> = {}): GoalInput {
  return {
    studentId: 's1',
    subjectId: 'science',
    title: 'Fen netini yükseltmek',
    targetNet: 18,
    deadline: '2026-11-15',
    motivation: '',
    ...overrides,
  }
}
```

- API fabrikaları `apps/api/test/support/` altındadır ve kimlik verisini **Better Auth sunucu API'siyle** kurar (tabloya elle yazmaz): `createInstitution(auth, { type })` (organization), `createMember(auth, { institutionId, role, links })` (kullanıcı + üyelik + `membership_links`), `signInAs(app, member)` (e-posta girişinden dönen oturum çerezini başlık olarak döndürür).
- "Başarısızlıkta değişmez" kontrolü yardımcıyla yapılır (birimde `unchangedOnFailure`, API'de işlem öncesi/sonrası `records` satırlarının karşılaştırılması).
- Test verisi kurgusaldır. Gerçek kişi adı-soyadı eşleşmesi, gerçek T.C. kimlik numarası, gerçek telefon veya üretimden kopya veri kullanılmaz. Örnek kişiler CLAUDE.md'dekilerdir (Deniz Yılmaz, Ayşe Yılmaz, Selin Kaya).

## 4. PGlite kullanımı

- Her test dosyası kendi bellek içi PGlite örneğini açar ve **üretimdeki migration dosyalarını** (`apps/api/drizzle/`) uygular. `drizzle-kit push` veya testte elle `CREATE TABLE` yok.

```ts
// apps/api/test/support/app.ts
export async function buildTestApp() {
  const pg = new PGlite()
  const db = drizzle(pg)
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
  const app = await buildApp({ db, clock: () => new Date(now), logger: false })
  return {
    app,
    db,
    close: async () => {
      await app.close()
      await pg.close()
    },
  }
}
```

- Test yalıtımı kurum düzeyindedir: her test dosyası `before` içinde kendi kurumlarını (A ve B) ve rol başına bir üyeyi kurar, oturumları bir kez açar (scrypt her testte tekrarlanmasın). Her test kendi kayıtlarını önekli kimlikle oluşturur; tablo boşaltma veya test sırası varsayımı yok.
- Migration süresi dosya başına 1 sn'yi aşarsa bir kez migrate edilmiş veri dizini dökülüp (`dumpDataDir`) her dosyada yüklenir.
- PGlite tek bağlantılıdır. Eşzamanlılık (iki isteğin aynı `version` ile yarışması, `FOR UPDATE`, kilit beklemesi) ve PostgreSQL'e özgü uzantı davranışı PGlite'ta doğrulanamaz; bunlar Docker'da PostgreSQL 16 ile koşan ayrı `test:pg` takımındadır. Yerelde bu takım `apps/api/src/db/**` veya `apps/api/drizzle/**` değişince koşulur; CI'da her koşuda `api-pg` işinde PostgreSQL 16 servisiyle koşar.
- `test:pg` dosyaları `apps/api/test/**/pg-*.test.ts` (kök ve alt klasörler; Onur'un finans ölçümleri alan haritası gereği `test/finance/` altındadır); adres `TEST_PG_URL` ile verilir, yoksa takım atlanır (olağan `test` koşusunda da). Adres atılabilir ayrı bir veritabanı olmalıdır: `docker compose up -d`, `docker compose exec postgres createdb -U kampus kampus_test`, ardından `TEST_PG_URL=postgres://kampus:kampus-yerel@127.0.0.1:5433/kampus_test pnpm --filter @kampus/api test:pg`. Her `pg-*` dosyası `createPgDatabase` ile kendine özel geçici bir veritabanı (`kampus_pg_t_<zaman>_<rastgele>`) açar, migration'ları uygular ve sonda siler; bu yüzden `TEST_PG_URL` kullanıcısının `CREATEDB` yetkisi olmalıdır (CI'daki `kampus` süper kullanıcıdır). `TEST_PG_URL` yalnız yönetim bağlantısıdır, içine hiçbir şey yazılmaz: kurum sayısı koşudan koşuya birikmez ve bütün kurumlara iş açan dağıtım testleri belirlenimci kalır (#17). Kesilen koşudan kalan, 30 dakikadan eski ve bağlantısız `kampus_pg_t_*` veritabanları sonraki koşuda silinir. Her test yine kendi kurumunu kurar.

## 5. Kiracı izolasyonu ve yetki testleri

Her uç için zorunlu senaryolar (iki kurum A ve B, kullanıcı A'dan):

1. Kimliksiz istek → 401.
2. Yanlış rol → 403.
3. B'ye ait kaydın kimliğiyle okuma, güncelleme, arşivleme, komut → 404 ve B'nin satırları değişmemiş.
4. Liste uçları B'nin hiçbir kaydını döndürmez (B'ye bilinen kayıt eklenip yanıtta aranır).
5. İstek gövdesine veya sorguya `institutionId: B` eklemek etkisizdir (şema reddeder → 400, ya da yok sayılır; kayıt A'ya yazılır).
6. Rol kapsamı: veli yalnız kendi çocuğu, öğrenci yalnız kendisi, öğretmen yalnız kendi sınıfı/branşı; rehberlik iç notu veli/öğrenci yanıtında yok.
7. Modül kapalı → 403 `module_disabled`.

Oturum ve kimlik yapılandırması için bir kez (uç başına değil, `auth.test.ts`'te):

- İptal edilmiş oturum ve süresi dolmuş oturum → 401; üyeliği kaldırılmış kullanıcı → 403; etkin kurumu olmayan oturum → 403 `no_active_institution`.
- Kullanıcı A'nın B'yi etkin kurum yapma denemesi reddedilir.
- Rol değişikliği bir sonraki istekte etkili (oturum önbelleği kapalı).
- `Sec-Fetch-Site: cross-site` veya izinsiz `Origin` ile `POST` → 403 `csrf_rejected`.
- Hassas işlem eski oturumla → 403 `reauthentication_required`.
- Giriş hız sınırı devreye girer (429); parola sıfırlama yanıtı kayıtlı ve kayıtsız e-postada aynıdır; 12 karakterden kısa ve yaygın listedeki parola reddedilir; açık kayıt kapalıdır.
- Kimlik olayları `audit_log`'a yazılır; loglarda çerez ve parola görünmez.

Genel güvenlik ağı: `onRoute` kancasıyla toplanan bütün rotalar tek testte gezilir; açık uç listesinde (`/api/v1/auth/*` Better Auth uçları, `/api/v1/health`) olmayan her rota kimliksiz istekte 401 dönmelidir. Yeni açık uç bu listeye gerekçeyle eklenir. Ön başvuru formunun üç ucu (`/api/v1/prospects/application-forms/:formKey`, `/submissions`, `/frame-policy`; ON-133) oturumsuzdur, kurum form anahtarından çözülür.

### Çapraz kurum envanteri (IST-002)

`apps/api/test/cross-institution-inventory.test.ts` uygulamanın bütün rotalarını (`app.routeModules()`) okur ve her `method + url` için madde 3–5'in hangi testte sınandığını gösterir. Kural: başka kurumun kaydı 404 döner ve yanıt olmayan kimlikle aynıdır (varlık sızmaz); liste ve sayımlarda B'nin satırı görünmez ve değişmez.

- Sınıflar: `kayıt` (yol kimliği kurum kaydı; B kaydına okuma/yazma 404, B değişmez), `liste` (kimliksiz okuma, sayım, özet, güncel kayıt; B yok), `gövde` (kimliksiz oluşturma; gövdedeki `institutionId` ya da B kaydının kimliği etkisiz), `yok` (kurum kaydı almaz ve dönmez; gerekçe zorunlu). Yol kimliği taşıyan uç `kayıt` dışında sınıflanamaz.
- Kanıt denetimi metinseldir: satırın gösterdiği dosyada adı satırdaki parçayı içeren ve çapraz kurum senaryosunu anan (`başka kurum`, `kurumlar arası`, `institutionId` …) bir test bulunur; dosyada uç yolu ya da satırın `marker`'ı geçer. Sınıflanmamış uç, uygulamada olmayan satır ya da silinen test envanteri kırar.
- Tablo kalıbı: `support/cross-institution.ts` koşucusu (`runCrossCase`) B'de kaydı kurar, A'dan olmayan kimlikle ve B kimliğiyle aynı isteği yapar, yanıtların `status/code/message` eşitliğini ve iki kurumun satır özetinin değişmediğini doğrular; sonra aynı isteği A'nın kendi kaydıyla yapar (2xx, 409 ya da 422: 404 rol ya da gövdeden gelmiyor). İstek A'da işi yapmaya yetkili rolle yapılır; yönetici rolüyle 403 kurum sınırını sınamaz. Örnekler: `cross-institution-platform`, `-learning`, `-access`, `-finance`, `-workflows`.
- Yeni uç eklerken: çapraz kurum testini yaz (tablo dosyasına satır ya da uç testinde adı `başka kurum` içeren test), envantere uygun sınıfla satır ekle. `TODO` listesi boştur; yeni uç oraya değil tabloya testiyle girer. Karşı geliştiricinin ucunda açık bulunursa test `{ todo: '…' }` ile işaretlenir ve sahibine issue açılır.

## 6. Uçtan uca (e2e) kurallar

- Playwright, `tests/e2e/<akış>.spec.ts`. Seçiciler erişilebilir rol ve etiketle (`getByRole`, `getByLabel`); CSS sınıfı yalnız rolü olmayan yapıda.
- `waitForTimeout` yok; otomatik bekleyen `expect` veya `expect.poll`.
- Her test bağımsızdır, kendi kurumunu kurar ve kendi rolüyle giriş yapar. API'li uygulamada kurulum test ortamına özel uçla (`NODE_ENV=test` dışında kayıtlı değil) veya doğrudan seed betiğiyle yapılır; UI üzerinden kurulum yapılmaz.
- Giriş Better Auth uçlarıyla bir kez yapılıp oturum çerezi `storageState` ile yeniden kullanılır.
- Bir test bir akışı anlatır; adı Türkçe ve sonuç odaklıdır ("Öğretmen hedefi onaylar ve veli onayı görür").
- Kalıcılık API sorgusuyla doğrulanır (demo uygulamasında `stored(page)`).
- Zorunlu çeşitlemeler: masaüstü 1440 px; kritik akışlarda dar ekran (390 px) ve koyu tema; modül kapatınca menü ve doğrudan rota kapanır.
- Erişilebilirlik taraması her ana sayfada (bkz. [erisilebilirlik-performans.md](erisilebilirlik-performans.md)).
- İş kuralının bütün dalları e2e'de denenmez; bunlar birim testindedir.

### Vue demosu e2e portu

`pnpm test:e2e` Vue dev sunucusunu `E2E_VUE_PORT` (varsayılan 5173) portunda `--strictPort` ile kendisi açar ve **mevcut bir sunucuyu yeniden kullanmaz** (`reuseExistingServer: false`). Gerekçe: paralel worktree'lerde bir koşu başka worktree'nin sunucusuna bağlanıp yanlış kodu sınayabiliyordu; port doluysa koşu açık hatayla durur. Paralel koşuda her ajan kendi portunu verir: `E2E_VUE_PORT=5183 pnpm test:e2e`. Elle çalışan `pnpm dev` aynı porttaysa önce kapatılır.

### React web + API düzeni (`tests/e2e-react/`)

Vue demosunun e2e'sinden (`tests/e2e/`, `pnpm test:e2e`, `playwright.config.ts`) ayrıdır; komut `pnpm test:e2e:react` (`playwright.react.config.ts`). İki proje vardır: `masaustu` (1440×1000, bütün spec'ler) ve `dar-ekran` (360×740, yalnız `dar-ekran-*.spec.ts`); tek proje `--project=<ad>` ile koşulur. Yerelde `docker compose up -d` (PostgreSQL 16, 5433) gerekir; CI'da `e2e-react` işinin her parçası (`--shard`) aynı bilgilerle kendi PostgreSQL 16 servisini açar.

- **Global kurulum** (`support/global-setup.ts`): `kampus_e2e` veritabanı düşürülüp sıfırdan oluşturulur (yalnız `kampus_e2e` önekli adlar; `kampus` ve diğer veritabanlarına dokunulmaz) → `db:migrate` → `db:seed` → API `NODE_ENV=test`, port 3020 → web-react derlenir ve `vite preview` 4180'de açılır (`/api` vekil hedefi `KAMPUS_API_URL` ile 3020) → beş rol için oturum önbelleği yazılır. Bitince API ve önizleme kapanır. Gizli anahtar her koşuda rastgele üretilir, yalnız alt sürecin ortamına verilir. Günlükler `artifacts/e2e-react/*.log`.
- **Ortam değişkenleri**: `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DB_NAME` (`kampus_e2e…` önekli), `E2E_ADMIN_DATABASE_URL`, `E2E_SKIP_BUILD=1` (derleme güncelse atla), `E2E_FIELD_KEY` (alan şifreleme anahtarı; API ve fabrika aynısını kullanır, varsayılan gizli olmayan test anahtarı).
- **Hız sınırı**: giriş ucu IP başına dakikada 5. Test API'si `TRUST_PROXY=1` ile açılır ve her bağlam/API istemcisi kendi sahte `X-Forwarded-For` değerini taşır (`support/api.ts`); testler birbirinin kovasını tüketmez. Üretim yapılandırması değişmez.
- **Eski sayfa yarışı**: arama, süzgeç, sıralama, sayfa veya çocuk değişince URL hemen değişir ama eski sayfa yeni yanıt gelene kadar ekranda kalır. Satır/sayı okuyan beklenti anlık görüntü almaz: `expect.poll` ya da otomatik bekleyen beklenti kullanır; her satırı denetleyen döngü `for (const row of await rows.all())` yerine `expectEveryRow(rows, metin)` (`support/ui.ts`) olur.
- **Yardımcılar** (`support/fixtures.ts`): `loginAs(rol | { email }, { fresh? })` testin kendi bağlamına oturum çerezini koyar; `api(rol | null, { fresh? })` doğrudan API istemcisi verir (`get/post/patch/put/delete`, `{ status, ok, body }`); `ui.ts` içinde `switchInstitutionThroughMenu`, `signOutThroughMenu`, `expectNoHorizontalOverflow`.
- **Temiz durum stratejisi**: (1) Salt okunur testler rol başına paylaşılan önbellek oturumunu kullanır; bu oturum ve seed kurumları (Akademi, Kampüs Dil) **hiçbir test tarafından değiştirilmez**. (2) Oturumu değiştiren testler (çıkış, kurum değiştirme, parola) `fresh: true` ile kendi oturumunu açar; paylaşılan oturumu bozmaz. (3) Sunucuda veri yazan testler (ödeme, yoklama, not …) seed kurumlarına yazmaz: `tenant({ roles, students?, classes? })` fixture'ı testin kendi kurumunu kurar. Kurulum `support/tenant.ts` içindedir ve API'ye test ucu eklemez: `kampus_e2e` veritabanına doğrudan, API'nin `services/identity.ts` (kurum, hesap, üyelik) ve `db/records.ts` (`insertMissingRecords`) işlevleriyle yazar; çalışan API aynı veritabanını okuduğu için testin girişi ve istekleri o kurumu görür. Kurum, `createSeed` verisinin alt kümesini (temel koleksiyonlar, seçilen öğrenciler ve onların yoklama/not/taksit/sözleşme kayıtları) seed ile **aynı kayıt kimlikleriyle** taşır (`s10`, `c3`, `inv-s10-5`); kurumlar ayrı olduğundan çakışma olmaz ve test seed'deki sabit kimliklere dayanabilir. Her test benzersiz önekli kurum ve e-postayla kurulduğu için tekrar koşu (`--repeat-each`) ve aynı testin paralel kopyaları birbirinin kaydını görmez. Seçim gerekçesi: mevcut API'de taksit/öğrenci oluşturan bir uç yoktur, UI'dan kurulum yasaktır ve üretim API'sine yalnız test için uç eklenmez; doğrudan veritabanı yazımı ek yüzey açmaz, şema değişirse tip denetimi kırılır. Giriş: `loginAs(tenant.user('ogretmen'))`, API: `api(tenant.user('yonetici'))`. (4) Veritabanı koşular arasında sıfırlanır, koşu içinde temizlenmez; test kendi kurumunun verisini silmeye çalışmaz. (5)`fullyParallel` açıktır; sıra varsayılmaz.

## 7. Kararsız (flaky) test politikası

- Tanım: kod değişmeden bazen geçen bazen düşen test.
- Birim ve bütünleşik testlerde yeniden deneme yoktur. E2E'de yalnız CI'da `retries: 1`; yeniden denemede geçen test raporda "flaky" görünür ve yeşil sayılmaz, kayıt açılır.
- Kararsız test aynı gün sahiplenilir. İki iş günü içinde düzeltilemezse `test.fixme('… kayıt #<no>')` ile karantinaya alınır. Karantinada en fazla üç test bulunur; iki haftada düzeltilmeyen test ya yeniden yazılır ya silinir ve kapsadığı akış başka teste taşınır.
- Zaman aşımını yükseltmek veya `test.slow()` eklemek düzeltme sayılmaz.
- Sık nedenler ve çözüm: gerçek saat → `now`; paylaşılan veri → kendi kurumu; animasyon → azaltılmış hareket; sıra varsayımı → açık sıralama; ağ yarışı → yanıtı veya görünür durumu bekle.

## 8. CI süre bütçesi

Toplam duvar saati hedefi **12 dk** (iş zaman aşımı 15 dk). Push'ta `main`, `feature/**`, `fix/**` dallarında koşar; sahip dallarında (`oguzhan/**`, `onur/**`) Actions dakikası için kendiliğinden koşmaz, gerekirse `gh workflow run checks.yml --ref <dal>`. Bütçe aşılırsa önce paralelleştirilir ve bölünür, zaman aşımı yükseltilmez. `.github/workflows/checks.yml` işleri paralel koşar: `statik` (biçim, lint, typecheck, hook testleri, `openapi:check`, `generate:check`), `birim` (kök birim, kapsam eşikli api-client, react-shared), `api` (PGlite, `--test-shard` ile 3 parça), `api-pg` (PostgreSQL 16 servisiyle `test:pg`), `build`, `e2e-vue` (2 parça), `e2e-react` (3 parça, her parçada PostgreSQL 16) ve `web-budget` (React build, `pnpm size`, Lighthouse). Ortak kurulum `.github/actions/kurulum` içindedir (pnpm deposu ve Playwright tarayıcısı önbellekli); e2e başarısızlığında rapor, trace ve sunucu günlükleri artefakt olarak yüklenir. Aynı daldaki yeni push eski koşuyu iptal eder.

| Adım                                | Bütçe  |
| ----------------------------------- | ------ |
| Kurulum (önbellekli)                | 1,5 dk |
| Biçim + lint + typecheck            | 1,5 dk |
| Birim (kapsamlı)                    | 0,5 dk |
| API bütünleşik (PGlite)             | 2 dk   |
| Build                               | 1,5 dk |
| E2E (gerekirse iki parçaya bölünür) | 6 dk   |

Test başına sınırlar: birim testi tipik olarak 100 ms altında, dosya başına 2 sn; API testi 500 ms; e2e testi tipik 20 sn, üst sınır 45 sn. Sınırı aşan test bölünür.
