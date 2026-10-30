# Kod yazım kuralları

Kapsam: `apps/api`, `apps/web-react`, `apps/mobile`, `packages/*`. Vue uygulaması (`apps/web`) yalnız referanstır; bu kurallar ona uygulanmaz. Biçim Prettier'dandır (`singleQuote`, `semi: false`, `printWidth: 100`, `trailingComma: all`); biçim tartışması incelemede yapılmaz.

## 1. Dil ve isimlendirme

| Ne                       | Kural                                                            | Örnek                                              |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------- |
| Kod tanımlayıcıları      | İngilizce                                                        | `studentGoals`, `approveGoal`                      |
| Kullanıcıya dönük metin  | Türkçe, cümle sonu noktalı                                       | `'Reddetme gerekçesini yazın.'`                    |
| Yorum                    | Türkçe, "neden"i anlatır                                         | `// Veli yalnız yorum ekler; onay öğretmendedir.`  |
| Log `msg`, hata `code`   | İngilizce, makine tarafından okunur                              | `msg: 'goal approved'`, `code: 'version_conflict'` |
| Dosya                    | kebab-case                                                       | `tutor-conflicts.ts`, `use-persistent-draft.ts`    |
| React bileşen dosyası    | PascalCase, tek ana bileşen                                      | `DataTable.tsx`, `WorkflowScreen.tsx`              |
| Değişken, fonksiyon      | camelCase; boolean `is/has/can` ile                              | `isArchived`, `canApprove`                         |
| Tip, bileşen             | PascalCase; tipte `I`/`T` öneki yok                              | `type GoalStatus`, `function GoalCard()`           |
| Modül düzeyi sabit       | UPPER_SNAKE yalnız gerçek sabitte                                | `STORAGE_KEY`, `MAX_IMPORT_BYTES`                  |
| Hook                     | `use` + ad; dosya `use-<ad>.ts`                                  | `useGoalList` → `use-goal-list.ts`                 |
| Olay işleyici            | Prop `onX`, iç işleyici `handleX`                                | `onApprove={handleApprove}`                        |
| Test dosyası             | `<konu>.test.ts`, e2e `<akış>.spec.ts`                           | `student-goals.test.ts`                            |
| Veritabanı               | snake_case (bkz. [veritabani.md](veritabani.md))                 | `institution_id`                                   |
| JSON alanları, sorgu adı | camelCase                                                        | `?classId=c1&sort=-createdAt`                      |
| Zaman alanı              | an `...At` (ISO UTC), takvim günü `...Date` (`YYYY-MM-DD`)       | `approvedAt`, `dueDate`                            |
| Para alanı               | tamsayı kuruş; ad birim taşımaz, tip ve OpenAPI açıklaması taşır | `amount: 123456` → `1.234,56 ₺`                    |

Kalıcı değerler (rol anahtarları `yonetici`, `ogretmen`, `ogrenci`, `veli`, `onburo`; mevcut durum değerleri `'Aktif'`, `'Onay bekliyor'`) veri olduğu için değiştirilmez; yeni enum değeri İngilizce ve küçük harfli kod olur (`pending_approval`), Türkçe etiketi sunum katmanındadır.

Terim sözlüğü (yeni kodda bu karşılıklar kullanılır): kurum `institution`, kampüs `campus`, sınıf/şube `class`, öğrenci `student`, veli `parent`, öğretmen `teacher`, ön büro `frontDesk`, etüt `tutoring`, deneme `exam`, kazanım `outcome`, rehberlik `guidance`, taksit `installment`, dekont `receipt`, yoklama `attendance`, arşiv `archive`.

## 2. TypeScript

- `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. Enum, namespace, parametre özelliği, `declare` dışı ambient kod yok.
- Göreli içe aktarma `.ts`/`.tsx` uzantılıdır; tip yalnız `import type` ile gelir.
- İçe aktarma sırası (gruplar arasında boş satır): `node:*` → dış paket → `@kampus/*` → göreli.
- Adlı dışa aktarım (`export function`) kullanılır. `export default` yalnız çatının istediği yerde: Expo giriş dosyası, Vite/Drizzle/Playwright yapılandırması, `React.lazy` rota bileşeni.
- `any` yok; `unknown` + daraltma. `as` dönüşümü yalnız dış sınırda, doğrulamadan sonra. `!` (non-null) yalnız testte.
- Domain tipi Zod şemasından türer (`z.infer`); aynı şekil için ikinci elle yazılmış tip olmaz.
- Zod sınırda çalışır: HTTP girdi/çıktısı, ortam değişkeni, dosya/CSV içe aktarma, yerel depo okuma. Sınırın içindeki kod tiplere güvenir, tekrar doğrulamaz.
- Yapılandırma nesneleri `satisfies` ile tiplenir; birleşim tipleri `switch` + `never` kontrolüyle tüketilir.

```ts
export const goalStatus = {
  pending: 'pending_approval',
  active: 'active',
  rejected: 'rejected',
} as const
export type GoalStatus = (typeof goalStatus)[keyof typeof goalStatus]

function statusLabel(status: GoalStatus): string {
  switch (status) {
    case 'pending_approval':
      return 'Onay bekliyor'
    case 'active':
      return 'Aktif'
    case 'rejected':
      return 'Reddedildi'
    default:
      return status satisfies never
  }
}
```

## 3. Klasör yapısı

### `packages/school-core` (saf; DOM, Node, React, veritabanı yok)

```
src/
  data/       # deterministik örnek veri (seed), müfredat, soru bankası
  lib/        # iş kuralları, Zod şemaları, kapsam, biçimleyiciler; errors.ts burada
  modules/    # modül ve menü kaydı
  contracts/  # API istek/yanıt Zod şemaları; API ve api-client ortak kullanır
```

Dışa aktarım dosya yolu üzerindendir: `@kampus/school-core/lib/school-workflows.ts`. Barrel (`index.ts` ile `export *`) eklenmez.

### `apps/api`

```
src/
  app.ts            # buildApp(options): test ve sunucu aynı fabrikayı kullanır
  server.ts         # listen, SIGTERM ile düzgün kapanış
  config.ts         # ortam değişkenleri Zod ile doğrulanır; eksikse süreç başlamaz
  errors.ts         # AppError ve alt sınıfları
  plugins/          # auth, error-handler, request-context, rate-limit, security-headers, db
  routes/<alan>.ts  # HTTP: şema, kimlik, rol; iş kuralı ve SQL yok
  services/<alan>.ts# iş akışı: school-core çağrısı, transaction
  db/
    schema/<tablo>.ts
    client.ts
    records.ts      # records deposu (kurum kapsamlı okuma/yazma)
  lib/              # alan dışı yardımcılar (id, saat, sayfalama)
drizzle/            # üretilmiş migration'lar (commit edilir)
test/
  <alan>.test.ts
  support/          # buildTestApp, fabrikalar, loginAs
```

### `apps/web-react`

```
src/
  main.tsx, App.tsx, routes.tsx
  components/       # ortak bileşenler: DataTable.tsx, Modal.tsx, Pagination.tsx …
  pages/<alan>/     # rota bileşenleri ve yalnız o sayfaya ait parçalar: GoalListPage.tsx
  hooks/            # yalnız web'e özgü hook'lar (sunucu verisi değil)
  lib/              # web'e özgü yardımcılar (pdf, csv indirme)
  styles/           # tokens.css ve bileşen stilleri
```

Sunucu verisi `@kampus/react-shared` hook'larından gelir; bileşen içinde `fetch` yazılmaz.

### `apps/mobile` (mevcut yapı korunur)

```
src/
  AppRoot.tsx
  screens/          # PascalCase ekranlar: WorkflowScreen.tsx
  ui/               # ortak bileşenler, tema, ikonlar
  model/            # role göre görünür veri, sunum modelleri (platformdan bağımsız)
  store/            # oturum, tema, taslaklar
  lib/              # dosya seçimi, paylaşım gibi cihaz yardımcıları
```

### `packages/api-client` ve `packages/react-shared`

```
api-client/src/
  client.ts         # createApiClient({ baseUrl, fetch, tokenStore }); yenileme dahil
  errors.ts         # ApiError (status, code, message, issues, requestId)
  endpoints/<alan>.ts
react-shared/src/
  session/          # oturum sağlayıcı ve hook'ları
  queries/<alan>.ts # use-<alan>-list, use-<alan>-mutation
```

`api-client` React'e, DOM'a ve React Native'e bağımlı değildir; `fetch` ve belirteç deposu dışarıdan verilir.

## 4. Çatıya özgü kurallar

### Fastify (API)

- Her rota `/api/v1` önekiyle kaydedilir ve `schema` içinde `params`, `querystring`, `body` ve **`response`** taşır. Yanıt şeması zorunludur; şemada olmayan alan istemciye gitmez.
- Kimlik, rol ve modül kontrolü `preHandler` ile bildirilir: `preHandler: [app.authenticate, app.requireRole(['yonetici', 'ogretmen']), app.requireModule('goals')]`.
- Handler `async` olur ve değer döndürür; `reply.send` ile dönüş karıştırılmaz.
- Servis `request` nesnesi almaz; açık bağlam alır: `{ db, institutionId, actor, now, log }`. Bu sayede servis test edilirken HTTP gerekmez.
- `fastify-plugin` yalnız dekoratörün kapsüllemeden çıkması gerekiyorsa kullanılır.
- Ortam değişkeni yalnız `config.ts`'te okunur; başka yerde `process.env` yok.

```ts
app.post(
  '/goals/:goalId/approve',
  {
    schema: { params: goalParams, body: approveGoalBody, response: { 200: goalResponse } },
    preHandler: [
      app.authenticate,
      app.requireRole(['yonetici', 'ogretmen']),
      app.requireModule('goals'),
    ],
  },
  async (request) => {
    const goal = await approveGoal(request.ctx, request.params.goalId, request.body)
    return { data: goal }
  },
)
```

### React (web)

- Fonksiyon bileşeni; props tipi `type Props = { … }`; `React.FC` kullanılmaz.
- Türetilebilen değer state'te tutulmaz; render sırasında hesaplanır. `useEffect` yalnız dış sistemle eşitleme içindir (abonelik, DOM ölçümü); veri çekme ve türetilmiş state için kullanılmaz.
- Liste anahtarı kalıcı kimliktir, dizin değildir.
- `useMemo`/`memo` ölçülmüş yavaşlıkta kullanılır.
- Form doğrulaması school-core Zod şemasıyla; API'den gelen `issues` alanlara eşlenir; gönderim sürerken düğme kilitlenir.
- Her rota bir hata sınırı (error boundary) içinde render edilir; kullanıcı Türkçe mesaj ve "Yeniden dene" görür.
- Ağır kitaplıklar (pdfjs, jspdf) yalnız kullanıldığı anda `import()` ile yüklenir.

### Expo (mobil)

- Ekranlar `screens/`, yeniden kullanılan parçalar `ui/`; renk ve ölçü `ui/theme.ts`'den. Satır içi sabit renk yok.
- Her dokunulabilir öğe en az 48 dp, `accessibilityRole` ve `accessibilityLabel` taşır.
- 20'den fazla öğeli listeler `FlatList`/`SectionList` ile; `ScrollView` içinde `map` yok.
- Belirteçler `expo-secure-store`'da; AsyncStorage'a kişisel veri veya belirteç yazılmaz (geçiş bitene kadar mevcut demo snapshot'ı istisnadır).
- `EXPO_PUBLIC_*` değişkenleri pakete gömülür ve herkese açıktır; gizli değer içeremez.
- Ayrıntılı mobil kurallar `apps/mobile/CLAUDE.md` içindedir.

## 5. Hata yönetimi

### Hata sınıfları

| Katman      | Sınıf                       | Kullanım                                                                       |
| ----------- | --------------------------- | ------------------------------------------------------------------------------ |
| school-core | `DomainError`               | İş kuralı reddi. `code`, Türkçe `message`, `kind`, isteğe bağlı `path`.        |
| api         | `AppError` ve alt sınıfları | HTTP'ye eşlenen hatalar (aşağıdaki tablo).                                     |
| api-client  | `ApiError`                  | Sunucu hata zarfının istemcideki karşılığı; ağ hatası `code: 'network_error'`. |

`DomainError.kind` → HTTP: `rule` → 422, `conflict` → 409, `forbidden` → 403, `not_found` → 404. Ayrıntı: [api-tasarimi.md](api-tasarimi.md#4-hata-zarfı).

API alt sınıfları: `ValidationError` (400), `AuthenticationError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `RuleViolationError` (422), `RateLimitError` (429). Bilinmeyen her hata 500 + `internal_error` olur.

`erasableSyntaxOnly` parametre özelliğine izin vermediği için alanlar açık yazılır:

```ts
export type DomainErrorKind = 'rule' | 'conflict' | 'forbidden' | 'not_found'

export class DomainError extends Error {
  readonly code: string
  readonly kind: DomainErrorKind
  readonly path: readonly string[] | undefined

  constructor(
    code: string,
    message: string,
    options: { kind?: DomainErrorKind; path?: string[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'DomainError'
    this.code = code
    this.kind = options.kind ?? 'rule'
    this.path = options.path
  }
}

throw new DomainError('goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.', {
  kind: 'conflict',
})
```

Geçiş notu: school-core bugün `throw new Error('…Türkçe…')` kullanıyor. TS'e taşınan dosyada bu çağrılar mesaj değiştirilmeden `DomainError`'a çevrilir. API yalnız `DomainError`'ı kullanıcı hatası sayar; düz `Error` 500'dür (programlama hatası kullanıcıya iş kuralı gibi gösterilmez).

### Kurallar

- Yalnız `Error` (veya alt sınıfı) fırlatılır; dize, nesne fırlatılmaz.
- Boş `catch` yok. `catch` yalnız üç amaçla yazılır: bağlam ekleyip yeniden fırlatmak (`{ cause }`), bilinen hatayı başka sınıfa çevirmek, kullanıcıya gösterip loglamak.
- Hata yakalandığı yerde ya loglanır ya yeniden fırlatılır; ikisi birden değil (çift log olmaz).
- Kullanıcıya teknik ayrıntı (yığın, SQL, dosya yolu, kimlik) gösterilmez; her hata yanıtında `requestId` bulunur, destek bu kimlikle logu bulur.
- Promise'ler bekletilir (`await`) veya `void` ile bilinçli bırakılır; bırakılan promise `.catch` taşır.
- İstemci: `ApiError.issues` form alanlarına, diğer hatalar toast'a gider. 401 bir kez sessiz yenileme denenir, başarısızsa oturum kapanır.

## 6. Loglama

- API'de Fastify'ın pino logger'ı kullanılır; `console.*` yok (betikler hariç). Üretimde düzey `info`, testte `silent`, geliştirmede `debug` + `pino-pretty`.
- Log yapılandırılmıştır: `msg` kısa İngilizce cümle, bağlam alanlarda. Her istek logunda `reqId`, `institutionId`, `userId`, `route`, `statusCode`, `responseTime` bulunur (`request.log.child` ile).
- Olay adları `event` alanında noktalı biçimde: `auth.login_failed`, `records.version_conflict`, `payment.recorded`.
- Düzeyler: `error` = 5xx ve müdahale gerektiren; `warn` = beklenen ama izlenmesi gereken (yenileme belirteci yeniden kullanımı, hız sınırı); `info` = istek özeti ve iş olayı; `debug` = geliştirme.
- İstek/yanıt gövdesi loglanmaz. Kişisel veri yerine kimlik loglanır (`studentId`, e-posta değil). Zod hatasında yalnız alan yolları (`issues[].path`) loglanır, değerler değil.
- Maskeleme zorunlu ve merkezi:

```ts
const app = Fastify({
  logger: {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.token',
        '*.refreshToken',
        '*.email',
        '*.phone',
        '*.nationalId',
      ],
      censor: '[gizli]',
    },
  },
})
```

- Web ve mobil: teknik hata yerel halka tamponunda (son 100 kayıt) tutulur; uzak log servisi (SaaS) eklenmez. Sunucuya istemci hatası gönderimi gerekirse kendi ucumuzla, kişisel veri içermeden yapılır.

Kişisel veri sınıfları ve loglanamayacak alanlar: [guvenlik-kvkk.md](guvenlik-kvkk.md#8-kişisel-veri-sınıflandırması).

## 7. Yorum yoğunluğu

- Kod ne yaptığını isimleriyle anlatır; yorum **neden**i, iş kuralının kaynağını veya beklenmeyen bir kısıtı anlatır.
- Hedef: iş kuralı dosyalarında karar noktası başına en fazla bir kısa yorum; basit CRUD ve bileşenlerde neredeyse sıfır.
- Dışa aktarılan paket API'si (school-core işlemleri, api-client metotları) adı ve tipi yetmiyorsa tek satırlık TSDoc alır.
- Yorum satırına alınmış kod commit edilmez. `TODO` biçimi: `// TODO(<konu>): neden` (ör. `// TODO(ts): …`); sahipsiz TODO incelemede reddedilir.

```ts
// Anahtar revizyonu eski analizi geçersiz kılar; aksi halde öğrenci yanlış nete göre etüde atanır.
if (key.revision !== analysis.keyRevision)
  throw new DomainError('analysis_stale', 'Optik analizi yeniden çalıştırın.')
```

## 8. Bağımlılık ekleme politikası

Yeni paket son çaredir. Sırayla sorulur: platform (Node, Web API, React, Expo) çözüyor mu? Mevcut bağımlılık çözüyor mu? 50 satırlık kendi kodumuz yeter mi?

Eklenecekse commit gövdesinde gerekçe yazılır:

```
Bağımlılık: <paket>@<sürüm>
Neden: <hangi ihtiyaç, neden kendi kodumuz değil>
Alternatifler: <değerlendirilenler>
Boyut: <web/mobil paketine gzip etkisi, yalnız sunucuysa "sunucu">
Bakım: <son sürüm tarihi, bakımcı sayısı>
Lisans: <SPDX>
Kurulum betiği: <var/yok; varsa allowBuilds gerekçesi>
```

- **Sürüm sabitlenir:** `package.json`'da tam sürüm (`"zod": "4.6.5"`). İstisna: Expo SDK paketleri `pnpm expo install` ile `~` alır. Mevcut `^` girdileri dokunulduğunda tam sürüme çevrilir.
- **Yer:** bağımlılık onu kullanan pakete eklenir; kök `package.json` yalnız araç zinciri içindir. Tip paketleri `devDependencies`'e.
- **Lockfile** aynı committe güncellenir; CI `--frozen-lockfile` ile kurar.
- **Lisans:** izinli MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0. MPL-2.0 değiştirilmeden kullanımda izinli. GPL, AGPL, LGPL, SSPL, BUSL, ticari olmayan (NC) ve lisanssız paket eklenmez. Kontrol: `pnpm licenses list --prod`.
- **Güvenlik:** `pnpm-workspace.yaml`'daki yayın yaşı beklemesi ve kurulum betiği izinleri (`allowBuilds`, `onlyBuiltDependencies`) korunur; istisna tam sürümle ve gerekçeyle eklenir.
- **Tek ihtiyaç, tek kitaplık:** ikon için lucide, doğrulama için Zod, tarih için `Intl` + school-core `format`. İkinci bir tarih, durum yönetimi veya UI kitaplığı ADR'siz eklenmez.
- **Dış servis** (SaaS SDK'sı, analitik, hata izleme) ADR 0001 gereği eklenmez; gerekiyorsa ADR yazılır.
- Kullanılmayan bağımlılık aynı committe kaldırılır.
