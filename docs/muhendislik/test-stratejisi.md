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

- API fabrikaları `apps/api/test/support/` altındadır: `createInstitution(db, { type })`, `createUser(db, { institutionId, role, studentIds })`, `loginAs(app, user)` (yetkili başlıkları döndürür).
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

- Test yalıtımı kurum düzeyindedir: her test kendi kurumunu (`createInstitution`) kurar; tablo boşaltma veya test sırası varsayımı yok. Böylece testler aynı dosyada paralel koşabilir ve izolasyon kendiliğinden sınanır.
- Migration süresi dosya başına 1 sn'yi aşarsa bir kez migrate edilmiş veri dizini dökülüp (`dumpDataDir`) her dosyada yüklenir.
- PGlite tek bağlantılıdır. Eşzamanlılık (iki isteğin aynı `version` ile yarışması, `FOR UPDATE`, kilit beklemesi) ve PostgreSQL'e özgü uzantı davranışı PGlite'ta doğrulanamaz; bunlar Docker'da PostgreSQL 16 ile koşan ayrı `test:pg` takımındadır. Bu takım `apps/api/src/db/**` veya `apps/api/drizzle/**` değişince ve gece koşar.

## 5. Kiracı izolasyonu ve yetki testleri

Her uç için zorunlu senaryolar (iki kurum A ve B, kullanıcı A'dan):

1. Kimliksiz istek → 401.
2. Yanlış rol → 403.
3. B'ye ait kaydın kimliğiyle okuma, güncelleme, arşivleme, komut → 404 ve B'nin satırları değişmemiş.
4. Liste uçları B'nin hiçbir kaydını döndürmez (B'ye bilinen kayıt eklenip yanıtta aranır).
5. İstek gövdesine veya sorguya `institutionId: B` eklemek etkisizdir (şema reddeder → 400, ya da yok sayılır; kayıt A'ya yazılır).
6. Rol kapsamı: veli yalnız kendi çocuğu, öğrenci yalnız kendisi, öğretmen yalnız kendi sınıfı/branşı; rehberlik iç notu veli/öğrenci yanıtında yok.
7. Modül kapalı → 403 `module_disabled`.

Genel güvenlik ağı: `onRoute` kancasıyla toplanan bütün rotalar tek testte gezilir; açık uç listesinde (`/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/health`) olmayan her rota kimliksiz istekte 401 dönmelidir. Yeni açık uç bu listeye gerekçeyle eklenir.

## 6. Uçtan uca (e2e) kurallar

- Playwright, `tests/e2e/<akış>.spec.ts`. Seçiciler erişilebilir rol ve etiketle (`getByRole`, `getByLabel`); CSS sınıfı yalnız rolü olmayan yapıda.
- `waitForTimeout` yok; otomatik bekleyen `expect` veya `expect.poll`.
- Her test bağımsızdır, kendi kurumunu kurar ve kendi rolüyle giriş yapar. API'li uygulamada kurulum test ortamına özel uçla (`NODE_ENV=test` dışında kayıtlı değil) veya doğrudan seed betiğiyle yapılır; UI üzerinden kurulum yapılmaz.
- Giriş bir kez yapılıp `storageState` ile yeniden kullanılır.
- Bir test bir akışı anlatır; adı Türkçe ve sonuç odaklıdır ("Öğretmen hedefi onaylar ve veli onayı görür").
- Kalıcılık API sorgusuyla doğrulanır (demo uygulamasında `stored(page)`).
- Zorunlu çeşitlemeler: masaüstü 1440 px; kritik akışlarda dar ekran (390 px) ve koyu tema; modül kapatınca menü ve doğrudan rota kapanır.
- Erişilebilirlik taraması her ana sayfada (bkz. [erisilebilirlik-performans.md](erisilebilirlik-performans.md)).
- İş kuralının bütün dalları e2e'de denenmez; bunlar birim testindedir.

## 7. Kararsız (flaky) test politikası

- Tanım: kod değişmeden bazen geçen bazen düşen test.
- Birim ve bütünleşik testlerde yeniden deneme yoktur. E2E'de yalnız CI'da `retries: 1`; yeniden denemede geçen test raporda "flaky" görünür ve yeşil sayılmaz, kayıt açılır.
- Kararsız test aynı gün sahiplenilir. İki iş günü içinde düzeltilemezse `test.fixme('… kayıt #<no>')` ile karantinaya alınır. Karantinada en fazla üç test bulunur; iki haftada düzeltilmeyen test ya yeniden yazılır ya silinir ve kapsadığı akış başka teste taşınır.
- Zaman aşımını yükseltmek veya `test.slow()` eklemek düzeltme sayılmaz.
- Sık nedenler ve çözüm: gerçek saat → `now`; paylaşılan veri → kendi kurumu; animasyon → azaltılmış hareket; sıra varsayımı → açık sıralama; ağ yarışı → yanıtı veya görünür durumu bekle.

## 8. CI süre bütçesi

Toplam duvar saati hedefi **12 dk** (iş zaman aşımı 15 dk). Bütçe aşılırsa önce paralelleştirilir ve bölünür, zaman aşımı yükseltilmez.

| Adım                                | Bütçe  |
| ----------------------------------- | ------ |
| Kurulum (önbellekli)                | 1,5 dk |
| Biçim + lint + typecheck            | 1,5 dk |
| Birim (kapsamlı)                    | 0,5 dk |
| API bütünleşik (PGlite)             | 2 dk   |
| Build                               | 1,5 dk |
| E2E (gerekirse iki parçaya bölünür) | 6 dk   |

Test başına sınırlar: birim testi tipik olarak 100 ms altında, dosya başına 2 sn; API testi 500 ms; e2e testi tipik 20 sn, üst sınır 45 sn. Sınırı aşan test bölünür.
