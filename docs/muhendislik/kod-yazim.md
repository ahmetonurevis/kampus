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

Genel sorun (tablo, form, diyalog, bildirim, kimlik, sorgu önbelleği, kuyruk) için klasöre kendi kütüphanemiz konmaz; ADR 0002 paketleri kullanılır. Kendi kodumuz alana özgü kural (school-core), paketleri bağlayan ince katman ve tasarım tokenlarıdır.

### `packages/school-core` (saf; DOM, Node, React, veritabanı yok)

```
src/
  data/       # deterministik örnek veri (seed), müfredat, soru bankası
  lib/        # iş kuralları, girdi Zod şemaları, kapsam, biçimleyiciler; errors.ts burada
  modules/    # modül ve menü kaydı
  content/    # içerik havuzu: taksonomi, kaynak/sürüm, görünürlük, kopya (ADR 0004; State dışı)
```

`content/` (ileride `skills/`, `cefr/`) modülleri State'e koleksiyon eklemez (ADR 0004 karar 2): girdi API servisinin ilişkisel tablolardan yüklediği tipli satırlardır, fonksiyon `now` alır ve yazılacak değişikliği döndürür.

Dışa aktarım dosya yolu üzerindendir: `@kampus/school-core/lib/school-workflows.ts`. Barrel (`index.ts` ile `export *`) eklenmez. İşlem girdi şemaları (ör. `workflowSchemas.goal`) hem API rotasında hem web/mobil formunda (`zodResolver`) kullanılır.

### `apps/api`

```
src/
  app.ts                # buildApp(options): test ve sunucu aynı fabrikayı kullanır
  server.ts             # listen, SIGTERM ile düzgün kapanış
  config.ts             # ortam değişkenleri Zod ile doğrulanır; eksikse süreç başlamaz
  auth.ts               # Better Auth yapılandırması (organization, access control, rate limit)
  errors.ts             # AppError ve alt sınıfları
  plugins/              # authenticate (Better Auth oturumu → request.ctx), error-handler,
                        # request-context, csrf; @fastify/* eklentilerinin kaydı
  routes/<alan>.ts      # HTTP: şema, kimlik, rol; iş kuralı ve SQL yok
  routes/<alan>.schemas.ts  # yanıt ve sorgu şemaları (girdi şeması school-core'dan)
  services/<alan>.ts    # iş akışı: school-core çağrısı, transaction
  jobs/<iş-adı>.ts      # pg-boss iş tanımı ve işleyicisi
  db/
    schema/<tablo>.ts   # Drizzle şeması; schema/auth.ts Better Auth CLI çıktısı
    client.ts
    records.ts          # records deposu (kurum kapsamlı okuma/yazma)
  lib/                  # alan dışı yardımcılar (id, saat, sayfalama, depolama arayüzü)
drizzle/                # üretilmiş migration'lar (commit edilir)
openapi.json            # üretilmiş sözleşme (commit edilir)
test/
  <alan>.test.ts
  support/              # buildTestApp, fabrikalar, signInAs
```

### `apps/web-react`

```
src/
  main.tsx, App.tsx, routes.tsx   # react-router 7
  components/ui/    # shadcn/ui CLI çıktısı (Radix); yalnız token ve erişilebilirlik için düzenlenir
  components/       # paketler üzerine ince katman: DataTable.tsx (TanStack Table), Modal.tsx …
  pages/<alan>/     # rota bileşenleri ve yalnız o sayfaya ait parçalar: GoalListPage.tsx
  hooks/            # yalnız web'e özgü hook'lar (sunucu verisi değil)
  lib/              # web'e özgü yardımcılar (pdf, csv indirme, auth-client.ts)
  styles/           # Tailwind v4 giriş dosyası ve tek token dosyası (@theme)
```

Sunucu verisi `@kampus/react-shared` hook'larından gelir; bileşen içinde `fetch` yazılmaz. `components/ui/` dosyaları CLI ile alınır (`pnpm dlx shadcn@<sürüm> add <bileşen>`); kaynak yapılandırma `components.json`'da durur, bileşen elle baştan yazılmaz.

### `apps/mobile` (mevcut yapı korunur)

```
src/
  AppRoot.tsx
  screens/          # PascalCase ekranlar: WorkflowScreen.tsx
  ui/               # ortak bileşenler, tema, ikonlar
  model/            # role göre görünür veri, sunum modelleri (platformdan bağımsız)
  store/            # tema, taslaklar (oturum Better Auth istemcisinde)
  lib/              # dosya seçimi, paylaşım gibi cihaz yardımcıları; auth-client.ts
```

### `packages/api-client` ve `packages/react-shared`

```
api-client/src/
  schema.d.ts       # openapi-typescript çıktısı (apps/api/openapi.json'dan); elle düzenlenmez
  client.ts         # openapi-fetch createClient + ara katman (X-Client-Version, X-Request-Id)
  errors.ts         # ApiError: hata zarfını TanStack Query'ye tipli taşıyan ince sınıf
react-shared/src/
  query-keys.ts     # anahtarlar etkin kurumla başlar: ['inst', institutionId, 'goals', filtre]
  queries/<alan>.ts # use-<alan>-list, use-<alan>-mutation (TanStack Query)
  forms/            # react-hook-form + zodResolver yardımcıları, issues → setError
```

`api-client` React'e, DOM'a ve React Native'e bağımlı değildir; `fetch` ve oturum başlıkları (web'de `credentials: 'include'`, mobilde Better Auth Expo istemcisinin çerezi) dışarıdan verilir. Uç başına elle istemci fonksiyonu yazılmaz; çağrı `client.GET('/api/v1/goals', { params })` biçimindedir.

## 4. Çatıya özgü kurallar

### Fastify (API)

- Her rota `/api/v1` önekiyle kaydedilir ve `schema` içinde `params`, `querystring`, `body` ve **`response`** taşır (`fastify-type-provider-zod`). Yanıt şeması zorunludur; şemada olmayan alan istemciye gitmez.
- Resmi eklentiler kullanılır: `@fastify/helmet`, `cors`, `cookie`, `rate-limit`, `multipart`, `swagger` (+ `swagger-ui` yalnız geliştirmede). Aynı işi yapan ara katman elle yazılmaz.
- Better Auth işleyicisi `/api/v1/auth/*` altına bağlanır; diğer rotalar oturumu `app.authenticate` ön işleyicisinde `auth.api.getSession({ headers })` ile alır.
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

### Arka plan işleri (`pg-boss`)

- İş adı noktalı İngilizce: `exam-results.import`, `notifications.send`. Tanım ve işleyici `src/jobs/<ad>.ts`'te; işleyici aynı servis katmanını çağırır.
- İş yükü yalnız kimlik taşır: `{ institutionId, actorUserId, importId }`. Kişisel veri, dosya içeriği veya oturum bilgisi yüke yazılmaz.
- İşleyici idempotenttir (pg-boss en az bir kez teslim eder): aynı iş iki kez koşarsa sonuç değişmez. Tekrarı önlemek için `singletonKey`.
- Yeniden deneme sınırlı ve geri çekilmeli (`retryLimit`, `retryBackoff`); son hata `error` düzeyinde loglanır ve kullanıcıya iş durumu ucuyla Türkçe gösterilir.
- İşin yaptığı yazma `audit_log`'a `actor_user_id` = işi başlatan kullanıcı olarak yazılır.

### React (web)

- Fonksiyon bileşeni; props tipi `type Props = { … }`; `React.FC` kullanılmaz.
- Önce hazır bileşen: diyalog, menü, popover, sekme, seçim kutusu shadcn/ui (Radix); tablo `@tanstack/react-table`; form `react-hook-form`; bildirim `sonner`; tarih seçici `react-day-picker`. Radix'in verdiği odak yönetimi ve ARIA davranışı ezilmez.
- Stil Tailwind v4 sınıflarıyla ve yalnız token değişkenleriyle; bileşende sabit hex, sabit `backdrop-filter` değeri veya satır içi `style` ile renk yok. Cam yalnız yüzen katmanda (ADR 0002 karar 6).
- Türetilebilen değer state'te tutulmaz; render sırasında hesaplanır. `useEffect` yalnız dış sistemle eşitleme içindir (abonelik, DOM ölçümü); veri çekme ve türetilmiş state için kullanılmaz.
- Sunucu durumu yalnız TanStack Query'de; aynı veri ayrıca `useState`'e kopyalanmaz. Sorgu anahtarı etkin kurumla başlar; kurum değişince `queryClient.clear()`.
- Liste anahtarı kalıcı kimliktir, dizin değildir.
- `useMemo`/`memo` ölçülmüş yavaşlıkta kullanılır.
- Form doğrulaması `zodResolver(<school-core şeması>)`; API'den gelen `issues` `setError` ile alanlara eşlenir; gönderim sürerken düğme kilitlenir.
- Her rota bir hata sınırı (error boundary) içinde render edilir; kullanıcı Türkçe mesaj ve "Yeniden dene" görür.
- Ağır kitaplıklar (pdfjs, jspdf, recharts) yalnız kullanıldığı rotada veya anda `import()` ile yüklenir. `date-fns` fonksiyon bazında içe aktarılır.

### API'li liste ekranı kalıbı (web-react)

Örnek ekranlar: `pages/management/CampusesPage.tsx` ve `StaffPage.tsx` (yönetici, yalnız okuma). Yeni liste ekranı aynı sırayla kurulur; alt katmanlar hazır olduğundan elle `fetch`, `useEffect` veya sayfalama kodu yazılmaz.

Parçalar:

- `react-shared`: `collections.ts` (saf sorgu/sayfa işlevleri) ve `use-collection.ts` (`useCollectionList`, `useCollectionAll`, `useCollectionItem`, `useCollectionFetchAll`). Sorgu anahtarı `institutionKey(kurum, …)` ile etkin kurumla başlar; kurum değişince önbellek temizlenir.
- `hooks/use-core-collection.ts`: koleksiyon adını `State` anahtarına bağlayan tipli sarmalayıcılar (`useCoreList/All/Item/FetchAll`); kayıt tipi elle yazılmaz.
- `hooks/use-list-state.ts` + `lib/list-url.ts`: arama, sayfa, sıralama ve (`urlFilters` verilen) tekli filtreler URL'de; filtre değişince sayfa 1'e döner.
- `lib/collection-list.ts`: `CollectionListConfig` ile `ListState` → sunucu sorgusu (`collectionQueryFromList`, CSV için sayfasız `exportQueryFromList`, `sortableColumns`). Kısa arama (<2 karakter) gönderilmez.
- `components/DataTable.tsx` `ServerDataTable`: sunucu sayfalı tablo; masaüstünde sabit başlık/işlem sütunu, dar ekranda kart. Yükleniyor, boş ve hata durumları kendisindedir. Boş sonuçta arama, değeri dolu filtre veya `externalActive` yoksa `empty` metni (varsayılan "Henüz kayıt yok.") gösterilir ve "Aramayı ve filtreleri temizle" düğmesi çıkmaz; daraltma varsa `emptyFiltered` metni ve düğme gelir (`lib/list-view.ts` `emptyListView`; `CollectionList` aynı `listNarrowed`'i kullanır).
- `hooks/use-detail-panel.ts` (`?parametre=<id>` ile URL'li sağ panel; geri/ileri kapatır ve açar), `use-debounced-value.ts` (arama 300 ms), `use-csv-export.ts` (tüm sayfaları çeker, indirir).
- `components/QueryError.tsx`: Türkçe hata + "Yeniden dene"; `module_disabled` hatası kullanıcıyı dashboard'a götürür. `pages/page-registry.tsx`: taşınmış sayfaların tembel kaydı.

Yeni ekran eklerken:

1. API'nin o koleksiyon için izin verdiği sıralama alanları ve filtreleri (`SORT_FIELDS`, filtre alanları) belirlenir; `CollectionListConfig` sabiti `satisfies` ile yazılır. API'de karşılığı olmayan sütun sıralanamaz, olmayan filtre eklenmez; eksik `TODO(api-…)` ile işaretlenir.
2. `useListState('<anahtar>', { urlFilters })` → `useDebouncedValue(state.query)` → `useCoreList(koleksiyon, collectionQueryFromList(state, CONFIG, arama))`.
3. Kayıt → satır dönüşümü saf bir işlev olur (`management-rows.ts` gibi) ve `tests/` altında birim testi yazılır; ad eşlemeleri için küçük başvuru koleksiyonları `useCoreAll` ile bir kez çekilir. Büyük koleksiyon `useCoreAll` ile çekilmez.
4. `ServerDataTable` verilir: `rows`, `total`, `sortable`, `loading`, `fetching`, `error` (`QueryError`), `onRowClick`, `mobileColumns`; kampüs gibi dış filtreler `toolbar` ile, listeden türeyen filtreler `filters` ile (seçenekleri açıkça verilir).
5. Detay `useDetailPanel('<param>')` ve `useCoreItem` ile (liste satırından değil tek kayıt ucundan okunur; bağlantıyla gelinen kayıt da açılır). Panel başlığı erişilebilir addır ("Sınıf özeti").
6. CSV `useCoreFetchAll` + `exportQueryFromList` + `useCsvExport` ile; dosya yalnız görünen sayfayı değil tüm filtrelenmiş sonucu içerir. 5000 kayıt sınırı aşılırsa kullanıcıya Türkçe uyarı çıkar.
7. Sayfa `page-registry.tsx`'e (`lazy` + `MIGRATED` kümesi) eklenir; modül kapalıysa `QueryError` yönlendirir, ayrıca rota koruması RoleShell'dedir. e2e `tests/e2e-react/` altına: liste, arama, filtre (sayfa sıfırlanır), sayfalama, panel + geri/ileri, CSV içeriği, 390 px taşma.

Veli ekranlarında seçili çocuk adreste `?cocuk=<öğrenci kimliği>` taşınır (`use-child-selection`, `RoleShell` eksikse tamamlar); çocuğa bağlı sorgular `studentId` filtresi taşıdığından çocuk değişince önbellek anahtarı değişir ve liste kendiliğinden tazelenir. Kapsam dışı `?<panel>=<kimlik>` adresi tek kayıt ucundan 404 alır ve `QueryError` "Kayıt bulunamadı" gösterir; kayıt satırdan okunmaz.

### API'li dashboard kalıbı (web-react)

Örnek: `pages/dashboard/` (beş rolün "Genel Bakış" sayfası). Parçalar `DashboardParts.tsx` (`StatGrid`, `StatCard`, `DashboardGrid`, `ListCard`, `CardList`, `ShareBar`, `combineStates`), saf hesaplar `dashboard-model.ts` (birim testi `tests/dashboard-model.test.ts`).

- **Sayaçlar sunucuda sayılır:** `useCoreCounts(koleksiyon, { groupBy, sum?, filters })` (`GET /collections/:c/counts`); değer `countOf`/`sumOf` ile okunur, ortalama `sum / count`'tur. Sayaç için koleksiyon istemciye çekilip sayılmaz. Haftalık dilim gibi sıralı sayımlar `useCoreCountSeries` ile; bir dilim hata verirse seri gösterilmez.
- **Kısa listeler** sunucu sıralı ve sayfalıdır (`useCoreList(…, { sort, pageSize: 5 })`); bağlı adlar (öğrenci, sınıf, kampüs) satırın `joined` alanından gelir; ayrı öğrenci/sınıf isteği ve kimlik eşlemesi yapılmaz, ad gelmezse "—" gösterilir. Tarih aralığı (`dateField` + `dateFrom`/`dateTo`), `cancelled`, `graded` ve `counts?groupBy=<alan>:month` sunucuda süzülür; koşul istemcide sonradan uygulanmaz. Sunucuda süzgeci olmayan koşul yalnız kısa listeyi daraltabilir, sayaç üretmez ve `TODO(api-…)` taşır.
- **Düzen:** üstte sayaç ızgarası, altında 2:1 içerik (`DashboardGrid`: ana kart solda). Hızlı erişim bölümü yoktur; ikincil işlem kart başlığında sakin "Tümünü gör" bağlantısıdır. Kartlar opaktır.
- **Derin bağlantı:** kart ilgili listeyi filtresi adreste açar (`dashboardHref(rol, yol, { durum: 'gecikmis' }, çocuk)`); velide `?cocuk=` taşınır.
- **Durumlar:** her kart kendi yükleniyor/boş/hata durumunu gösterir (`ListCard` hatada `QueryError`). Kart modülü kapalıysa çizilmez (`session.modules` ve `module_disabled` yanıtı); dashboard kendine yönlendirilmez.
- **Kapsam:** sorgular rolün kapsamına sunucuda daraltılır; ekran rolün görmemesi gereken koleksiyonu hiç istemez (öğrenci `invoices` okumaz). Velide çocuğa bağlı sorgular `studentId` (veya çocuğun `classId`'si) taşır; çocuk değişince anahtar değişir.
- **Mini grafik** yalnız gerçek kayıtlardan türer; seri boşsa çizilmez ve metin gösterilir. Grafiğin yanında görünür metin özeti (`trendSummary`) bulunur, SVG `aria-hidden`'dır. `recharts` grafik bileşeninde `lazy(() => import(…))` ile ayrı parçadır; dashboard parçası onu ilk yüklemede getirmez. Renkler `tokens.css` `--chart-bar/-grid/-axis` değişkenlerinden `app.css` `.trend-bars` kurallarıyla gelir (açık/koyu tema, zorlanmış renk); örnek `AbsenceTrend.tsx` + `TrendBars.tsx`.

### API'li yazma kalıbı (react-shared + web-react)

Yazma uçları (`POST /invoices/:id/pay`, iş akışı komutları; api-tasarimi.md §1, §7) `@kampus/react-shared/use-api-command.ts` `useApiCommand` ile çağrılır; saf mantık `commands.ts`'tedir ve `node:test` ile sınanır. Örnek: `use-invoice-commands.ts` `usePayInvoice`, ekran `pages/finance/PaymentPanel.tsx`.

- **İstek anahtarı:** her kullanıcı eylemi `crypto.randomUUID()` ile yeni `Idempotency-Key` alır. Sonucu belirsiz hatadan (ağ, 5xx, `idempotency_in_progress`) sonra aynı gövdenin yeniden gönderimi aynı anahtarı taşır; sunucu işlemişse ilk yanıtı tekrarlar. Başarı, kesin hata veya gövde değişikliği anahtarı bırakır.
- **Sürüm:** `version(variables)` verilirse `If-Match: "<version>"` gider (form düzenlemeleri); tutmazsa 409 `version_conflict`. Core'un ikinci işlemi kendisi reddettiği komutlarda (ödeme) gönderilmez.
- **Kilit:** `submit` eşzamanlı bir kilitle korunur; çift tıklama veya Enter + tıklama ikinci isteği atmaz (`{ status: 'busy' }`). Düğme ayrıca `isPending` ile kilitlenir ve `aria-busy` taşır.
- **Tazeleme:** başarıda ve 409 çakışmada `invalidates` önekleri (`collectionKeyPrefix('invoices')`) etkin kurumla geçersiz kılınır; liste ve detay birlikte güncellenir. Ekran sonucu state'e kopyalamaz.
- **Hata:** `ApiError.issues` alanlara `setError` ile, mesaj `KampusProvider` `notifyError`'ı ile (web'de sonner toast) gider; 401'de bildirim yoktur (oturum katmanı yönlendirir). Koda özgü metin `messages` ile verilir (`invoice_already_paid`). `submit` hata fırlatmaz; `success | failed | busy` sonucu döner.

```tsx
const pay = usePayInvoice({ onSuccess: () => notify.success('Tahsilat kaydedildi.') })
const form = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema) })
const onSubmit = form.handleSubmit(async (values) => {
  const outcome = await pay.submit({ invoiceId, ...values }, { setError: form.setError })
  if (outcome.status === 'success') onClose()
})
// <Button type="submit" disabled={pay.isPending} aria-busy={pay.isPending || undefined}>
```

Yeni komut: `react-shared`'de `use-<alan>-commands.ts` içinde `useApiCommand({ request, invalidates, messages? })`; `request` `client.POST(…, { params: { path, header: headers }, body })` biçimindedir. e2e: başarı ve kalıcılık (API sorgusu), çift tıklamada tek istek, 409 yolu, yetkisiz rolde menü ve rota kapalı.

#### Okul iş akışı sayfası (web-react)

İş akışı modülleri (`yemek-menusu`, `okul-takvimi`, `kulupler`; kalanlar sırayla) tek sayfayı paylaşır: `pages/workflows/WorkflowPage.tsx`. Ekran sunum yazmaz, core'u çağırır:

1. Menü yolundan core modül tanımı (`workflowPage(path)`); okunacak koleksiyonlar `workflow-state.ts` `MODULE_SOURCES` + kapsam kaynakları (`workflowSources`). `useWorkflowState` bunları `useCollectionsAll` ile okur, `buildWorkflowState` ile core `State` ve id → sürüm haritası kurar. Yardımcı koleksiyonun 403/404'ü boş sayılır (`isUnreadableCollectionError`), ana koleksiyonun hatası `QueryError`'dır.
2. Oturum `coreSession(session, childId)`: `/me` bağlantıları (`links`) ve velinin seçili çocuğu. Satır `workflowRows`, detay `workflowDetails`, oluşturma düğmeleri `workflowCreateActions` (yetkisi olmayan rolde düğme yok). Kapsam ve rehberlik iç not ayıklaması sunucudadır; ekran ayrı süzgeç yazmaz.
3. Liste `ServerDataTable` + `useListState('kayitlar', { urlFilters: { status: 'durum' } })` + `listView`: arama/durum/sıralama/sayfa URL'de, sayfalama istemcide, CSV tüm filtrelenmiş satırlar. `TODO(api-workflow-rows)`: satır metni birden çok koleksiyondan türediği için sunucu sayfalaması sonraki iştir.
4. Detay `useDetailPanel('kayit')` sağ panelde. Form `workflowForm(...).fields(values)` + react-hook-form; çözücü `normalizeWorkflowInput` sonrası core şemasını `zodResolver(schema, undefined, { raw: true })` ile uygular, sunucuya ham değer gider. İki adım ("Kontrol et" → "Onayla ve kaydet"); ≤ 6 alan `SidePanel`, fazlası `Modal size="wide"`. Gönderim `useWorkflowCommand(komut)`: konusu olan komutta okunan sürümle `If-Match`, `ApiError.issues` → `setError` ve düzenleme adımına dönüş.
5. Kapalı modülün doğrudan adresi kabuk içinde "Modül kullanıma kapalı" der (`showsClosedNotice`, `ModuleClosedPage`); diğer sayfalar uyarıyla dashboard'a döner. Yeni modül bağlamak `page-registry.tsx` `WORKFLOW_PATHS`'e yol eklemek ve e2e senaryosudur.

### Expo (mobil)

- Hazır paketler: React Navigation, TanStack Query, react-hook-form, `@better-auth/expo` + `expo-secure-store`. Cam yüzey iOS'ta `expo-glass-effect`, Android ve desteklenmeyen platformda opak token zemini.
- Ekranlar `screens/`, yeniden kullanılan parçalar `ui/`; renk ve ölçü `ui/theme.ts`'den. Satır içi sabit renk yok.
- Her dokunulabilir öğe en az 48 dp, `accessibilityRole` ve `accessibilityLabel` taşır.
- 20'den fazla öğeli listeler `FlatList`/`SectionList` ile; `ScrollView` içinde `map` yok.
- Oturum yalnız `@better-auth/expo` üzerinden güvenli depoda; AsyncStorage'a kişisel veri veya oturum yazılmaz (geçiş bitene kadar mevcut demo snapshot'ı istisnadır).
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
- İstemci: `ApiError.issues` form alanlarına (`setError`), diğer hatalar `sonner` toast'ına gider. 401 alınca oturum Better Auth istemcisiyle kapatılıp giriş ekranına dönülür; istemcide belirteç yenileme mantığı yazılmaz.

## 6. Loglama

- API'de Fastify'ın pino logger'ı kullanılır; `console.*` yok (betikler hariç). Üretimde düzey `info`, testte `silent`, geliştirmede `debug` + `pino-pretty`.
- Log yapılandırılmıştır: `msg` kısa İngilizce cümle, bağlam alanlarda. Her istek logunda `reqId`, `institutionId`, `userId`, `route`, `statusCode`, `responseTime` bulunur (`request.log.child` ile).
- Olay adları `event` alanında noktalı biçimde: `auth.login_failed`, `records.version_conflict`, `payment.recorded`.
- Düzeyler: `error` = 5xx ve müdahale gerektiren; `warn` = beklenen ama izlenmesi gereken (CSRF reddi, hız sınırı, iş yeniden denemesi); `info` = istek özeti ve iş olayı; `debug` = geliştirme.
- İstek/yanıt gövdesi loglanmaz. Kişisel veri yerine kimlik loglanır (`studentId`, e-posta değil). Zod hatasında yalnız alan yolları (`issues[].path`) loglanır, değerler değil.
- Beklenmeyen hata mesajsız loglanır (`loggableError`, `plugins/error-handler.ts`): ad, kod (pg SQLSTATE), mesaj satırı çıkarılmış yığın ve `cause` zinciri. Drizzle/pg mesajı sorgu parametrelerini ve çakışan değeri taşıyabilir.
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
        '*.currentPassword',
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

### İlke: önce hazır paket (ADR 0002)

Genel bir sorun (tablo, form, diyalog, menü, bildirim, tarih seçici, kimlik doğrulama, sorgu önbelleği, kuyruk, e-posta, nesne depolama) için kod yazılmaz; ADR 0002'deki seçili paket kullanılır. Kendi kodumuz yalnız üç yerdedir: alana özgü kural (school-core), paketleri bağlayan ince katman (ör. `DataTable`, `authenticate`) ve tasarım tokenları.

Sırayla sorulur:

1. ADR 0002 listesindeki bir paket çözüyor mu? → onu kullan, yeni paket ekleme.
2. Platform (Node, Web API, React, Expo SDK) veya mevcut bağımlılık çözüyor mu? → onu kullan.
3. Listede olmayan hazır paket gerekiyor → aşağıdaki ölçütlerin hepsini karşılamalı.
4. Hiçbir paket ölçütleri karşılamıyorsa veya iş alana özgüyse → kendi kodumuz, gerekçesiyle.

Aynı ihtiyaç için ikinci paket (ikinci tablo, form, tarih, ikon, durum yönetimi, UI kitaplığı) ADR'siz eklenmez.

### Yeni paket ölçütleri

| Ölçüt              | Eşik                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bakım              | Son 6 ayda sürüm, birden çok bakımcı veya kurumsal destek, güvenlik bildirimlerine yanıt veriliyor, arşivlenmemiş                                                                                                                                                                                                                    |
| TypeScript tipleri | Paket kendi tiplerini taşır; `@types/*` yalnız iyi bakılıyorsa. Node 24, React 19, Expo SDK 57 (mobilde yeni mimari) ile uyumlu, ESM                                                                                                                                                                                                 |
| Lisans             | Doğrudan bağımlılık: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause (ISC ve 0BSD MIT eşdeğeri kabul). Yazı tipi paketlerinde (ör. `@fontsource/*`) OFL-1.1 kabul. Dolaylı üretim bağımlılığında ek olarak BlueOak-1.0.0, CC0-1.0, CC-BY-4.0 (yalnız veri paketleri). GPL, AGPL, LGPL, SSPL, BUSL, ticari olmayan (NC), lisanssız: yasak |
| Erişilebilirlik    | Arayüz paketi WAI-ARIA desenlerine uyar, klavye ve ekran okuyucu desteği belgelidir (Radix düzeyi); mobilde `accessibility*` özelliklerini geçirir                                                                                                                                                                                   |
| Boyut              | Web: ağaç sarsılabilir (tree-shakeable); ilk yüklemeye giren gzip artışı ≤ 30 KB, değilse rota parçasına veya `import()`'a alınır. Mobil: APK artışı ölçülür                                                                                                                                                                         |
| Yayın yaşı         | pnpm `minimumReleaseAge` beklemesine uyulur; istisna yalnız `minimumReleaseAgeExclude`'a tam sürümle ve gerekçeyle                                                                                                                                                                                                                   |
| Sürüm sabitleme    | `package.json`'da tam sürüm (`"zod": "4.6.5"`); `^`/`~` yok. İstisna: Expo SDK paketleri `pnpm expo install` ile `~`                                                                                                                                                                                                                 |
| Kurulum betiği     | Yok tercih edilir; gerekiyorsa `allowBuilds`/`onlyBuiltDependencies`'e gerekçeyle                                                                                                                                                                                                                                                    |
| Dış servis         | Paket kendi başına dış servise veri göndermez (telemetri kapatılabilir değilse eklenmez); SaaS bağımlılığı ADR ister                                                                                                                                                                                                                 |

Eklenirken commit gövdesine yazılır:

```
Bağımlılık: <paket>@<tam-sürüm>
Neden: <ihtiyaç; ADR 0002 listesindeki paket neden yetmiyor>
Alternatifler: <değerlendirilenler>
Bakım: <son sürüm tarihi, bakımcılar>
Tipler: <paket içinde | @types>
Lisans: <SPDX>
Erişilebilirlik: <arayüz paketiyse belge bağlantısı>
Boyut: <gzip etkisi; yalnız sunucuysa "sunucu">
Kurulum betiği: <yok | allowBuilds gerekçesi>
```

### Diğer kurallar

- **Yer:** bağımlılık onu kullanan pakete eklenir; kök `package.json` yalnız araç zinciri içindir. Tip paketleri `devDependencies`'e.
- **Lockfile** aynı committe güncellenir; CI `--frozen-lockfile` ile kurar.
- Mevcut `^` girdileri dokunulduğunda tam sürüme çevrilir.
- **Kopyalanan kod** (shadcn/ui bileşenleri) CLI ile alınır, lisansı MIT'tir ve bizim bakımımızdadır; değişiklik token ve erişilebilirlikle sınırlıdır.
- **Üretilen kod** (`openapi-typescript` çıktısı, Better Auth CLI şeması, drizzle-kit migration'ları) elle düzenlenmez; üreten komut yeniden koşulur.
- Lisans kontrolü: `pnpm licenses list --prod`. Güvenlik denetimi: [guvenlik-kvkk.md](guvenlik-kvkk.md#15-bağımlılık-güvenliği).
- Kullanılmayan bağımlılık aynı committe kaldırılır.
