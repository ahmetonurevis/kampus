# Mühendislik kuralları

Kampüs platformunun kod, test, API, veri, güvenlik, erişilebilirlik ve sürüm kuralları. Dayandığı kararlar: ADR 0001 (Fastify 5 + TypeScript + PostgreSQL/Drizzle API, React 19 web, Expo mobil, çok kurumlu yapı) ve ADR 0002 (önce hazır paket: Better Auth, shadcn/ui + Tailwind v4, TanStack, react-hook-form, `openapi-fetch`, `pg-boss`; ölçülü Liquid Glass). Bu dizin ayrıntıdır; `.claude/rules/*.md` dosyaları buradan özetlenmiş, dosya yoluna göre yüklenen kısa kurallardır. Bir kural değişince ikisi aynı committe güncellenir. Domain iş kuralları `docs/domain/`, mimari kararlar `docs/adr/` altındadır.

## Dizin

| Belge                                                          | Konu                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [kod-yazim.md](kod-yazim.md)                                   | İsimlendirme, TS/React/Fastify/Expo/pg-boss kuralları, klasör yapısı, hata sınıfları, loglama, yorum, hazır paket ve bağımlılık ölçütleri   |
| [test-stratejisi.md](test-stratejisi.md)                       | Piramit, kapsam hedefleri, fabrikalar, PGlite, kiracı izolasyonu ve oturum testleri, e2e, flaky, CI süresi                                  |
| [api-tasarimi.md](api-tasarimi.md)                             | `/api/v1`, yollar, sayfalama/filtre, yanıt ve hata zarfı, durum kodları, idempotency, sürümleme, tarih/para, OpenAPI → istemci              |
| [veritabani.md](veritabani.md)                                 | snake_case, zorunlu kolonlar, Better Auth ve pg-boss tabloları, `records`, normalleştirme, migration, indeks, arşiv, `audit_log`            |
| [guvenlik-kvkk.md](guvenlik-kvkk.md)                           | Better Auth yapılandırması, parola, oturum, hız sınırı, CORS/CSRF/CSP, kiracı ve rol yetkisi, veri sınıfları, rıza, saklama, haklar, sırlar |
| [erisilebilirlik-performans.md](erisilebilirlik-performans.md) | WCAG 2.2 AA kontrol listesi, cam yüzey kuralları, web/API/mobil bütçeleri, ölçüm yöntemi                                                    |
| [git-ve-surum.md](git-ve-surum.md)                             | Dal adları, commit, birleştirme, semver, CHANGELOG, `workspace:` sabitleme                                                                  |

## Bir sayfalık özet

**Önce hazır paket.** Tablo, form, diyalog, bildirim, kimlik, sorgu önbelleği, kuyruk gibi genel sorunlar için kod yazılmaz; ADR 0002 paketleri kullanılır. Kendi kodumuz: school-core alan kuralları, paketleri bağlayan ince katman, tasarım tokenları. Listede olmayan paket bakım, TS tipleri, izinli lisans, erişilebilirlik, boyut, `minimumReleaseAge` ve tam sürüm sabitleme ölçütlerini karşılamalı; gerekçe commit gövdesinde. Üretilen kod (OpenAPI tipleri, Better Auth şeması, migration) elle düzenlenmez.

**Kod.** TypeScript strict + `erasableSyntaxOnly` + `noUncheckedIndexedAccess`; enum yerine `as const`; göreli içe aktarma `.ts` uzantılı. Tanımlayıcılar İngilizce, kullanıcı metni Türkçe, yorum Türkçe ve "neden" odaklı. Dosyalar kebab-case, React bileşenleri PascalCase. Adlı dışa aktarım. Zod yalnız sınırda; domain tipi `z.infer`.

**Hatalar ve log.** school-core `DomainError` (kod + Türkçe mesaj + tür) fırlatır; API bunu 422/409/403/404'e eşler, bilinmeyen her şey 500. Pino ile yapılandırılmış log; gövde, çerez, parola ve kişisel veri loglanmaz, maskeleme merkezî.

**API.** `/api/v1`, çoğul kebab-case kaynaklar, komutlar `POST /:id/<fiil>`; `/api/v1/auth/*` Better Auth'undur. Başarı `{ data, meta? }`; hata `{ code, message, issues?, requestId }`. Sayfa numaralı sayfalama (`page`, `pageSize ≤ 100`, `total`), akışlarda imleç. Güncelleme `version` taşır, çakışma 409. Ödeme ve toplu işlemlerde `Idempotency-Key` zorunlu. Tarih ISO UTC / `YYYY-MM-DD`, para tamsayı kuruş. Zod → OpenAPI (`openapi.json` commit) → `openapi-typescript` → `openapi-fetch`.

**Veri.** snake_case; kurum tablolarında `institution_id`, `created_at`, `updated_at`, `archived_at`, `version` zorunlu. Kimlik tabloları Better Auth CLI'dan üretilir; üyeliğin school-core bağlantısı `membership_links`'te. `records` jsonb bütün olarak, sürüm kontrollü, tek transaction'da yazılır; beş ölçütten biri tutunca ADR ile normalleştirilir. Migration ileri yönlü, uygulanmışı değişmez. Her indeks `institution_id` ile başlar. Silme = arşiv. `audit_log` yalnız eklenir.

**Güvenlik ve KVKK.** Better Auth: e-posta + parola, açık kayıt kapalı, 12+ karakter parola, veritabanı oturumu (14 gün, `cookieCache` kapalı), hassas işlemde taze oturum, yerleşik hız sınırı; elle belirteç yönetimi yok. Kurum yalnız oturumun etkin kurumundan (`organization`); başka kurumun kaydı 404. Roller access control ile, kayıt kapsamı school-core'da. Çerez oturumu nedeniyle CSRF denetimi. Veri sınıfları G/K/Ç/Ö; özel nitelikli veri ayrı tabloda ve şifreli. Kurum veri sorumlusu, platform veri işleyen; başvurulara en geç 30 gün.

**Test.** ~%70 birim, ~%25 API bütünleşik (PGlite, gerçek migration'lar, fabrikalar Better Auth API'siyle), ~%5 e2e. Her uçta 401/403/404(başka kurum)/400/başarı. Zaman `now` ile sabit. Flaky test iki iş gününde düzeltilir veya karantinaya alınır. CI 12 dk.

**Erişilebilirlik ve performans.** WCAG 2.2 AA (2.4.11, 2.5.7, 2.5.8, 3.3.7, 3.3.8 dahil); mobilde 48 dp. Cam yalnız yüzen katmanda, en kötü zeminde AA kontrast, azaltılmış saydamlıkta opak. LCP ≤ 2,5 sn, INP ≤ 200 ms, ilk JS ≤ 200 KB gzip; API p95 okuma 200 ms / yazma 400 ms; mobil soğuk açılış ≤ 2,5 sn.

**Git.** `feature/ fix/ docs/ chore/`; Türkçe emir kipi başlık, tek mantıksal değişiklik, her commit yeşil; doğrusal geçmiş (rebase). Davranış değişikliği aynı committe `changes/<konu>.md` parçası yazar; sürüm ve CHANGELOG yalnız teslimde, iç paketler `workspace:*`. İki geliştiricili entegrasyon (`onur/`, `oguzhan/` dalları, `--no-ff`) git-ve-surum §7.

## Araç zinciri önerileri

Bu bölüm öneri listesidir; uygulanmadı. Mevcut taban (`chore/ts-arac-zinciri`): TypeScript 6.0.3, typescript-eslint 8.72.1 `recommended` (yalnız `.ts`/`.tsx`), `tsconfig.base.json` (`strict`, `bundler`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `lib: es2023`, `types: ["node"]`), `pnpm typecheck` = `pnpm -r --if-present typecheck`, CI'da typecheck adımı. Her madde ayrı `chore/` commitiyle ve önce mevcut ihlaller ölçülerek açılmalı.

### ESLint / typescript-eslint

- `.ts`/`.tsx` için `recommended` yerine `recommendedTypeChecked` (sonra `strictTypeChecked`), `parserOptions.projectService: true`.
- Hata düzeyinde: `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `await-thenable`, `only-throw-error`, `prefer-promise-reject-errors`, `switch-exhaustiveness-check`, `consistent-type-imports` (`fixStyle: 'separate-type-imports'`), `no-explicit-any`, `no-unsafe-*` ailesi, `restrict-template-expressions`.
- Uyarı: `no-non-null-assertion` (testlerde kapalı), `no-unnecessary-condition`.
- Çekirdek: `eqeqeq`, `no-console` (`apps/api/src`, `packages/**`; `scripts/` hariç), `prefer-const`, `no-param-reassign` (school-core'da state değiştirme kalıbı nedeniyle önce ölçülmeli).
- `no-restricted-imports`:
  - `packages/school-core/**`: `react`, `react-native`, `vue`, `node:*`, `drizzle-orm`, `fastify`, `better-auth` yasak.
  - `packages/api-client/**`: `react`, `react-native` yasak.
  - `apps/web-react/**` ve `apps/mobile/**`: `apps/api/**` içe aktarımı yasak; `@kampus/school-core/lib/demo-persistence.ts` yeni kodda yasak; `@radix-ui/*` doğrudan değil `components/ui/` üzerinden.
  - `apps/api/src/**` (`auth.ts` dışında): `jose`, `jsonwebtoken`, `bcrypt*`, `argon2` yasak (kimlik Better Auth'ta).
- `no-restricted-globals`: `apps/web-react/src/{components,pages}/**` içinde `fetch` (veri `react-shared`'dan gelir); `packages/school-core/**` içinde `Date.now`'u `no-restricted-properties` ile (zaman `now` parametresinden). Web'de `localStorage`/`sessionStorage` yalnız tema tercihi dosyasında.
- React: `eslint-plugin-react-x` önerilen kurallar `.tsx` için; resmi `eslint-plugin-react-hooks` (`rules-of-hooks`, `exhaustive-deps`) web ve mobile; `@tanstack/eslint-plugin-query` önerilen kurallar.
- Web: `eslint-plugin-jsx-a11y` önerilen kurallar (`components/ui/` shadcn çıktısı için yalnız uyarı).
- Dosya adı: `eslint-plugin-unicorn` yalnız `filename-case` kuralı (`kebabCase`; `.tsx` bileşenler için `pascalCase` istisnası; shadcn'in kebab-case `components/ui/*.tsx` dosyaları istisna).
- Üretilen dosyalar (`packages/api-client/src/schema.d.ts`, `apps/api/src/db/schema/auth.ts`, `apps/api/drizzle/**`) lint dışı.
- `eslint-config-prettier` en sonda kalır.

### tsconfig

- Tabana ekle: `noFallthroughCasesInSwitch`, `noImplicitReturns`, `useUnknownInCatchVariables` (strict'te zaten açık; açık yazılması belgeler). `exactOptionalPropertyTypes` school-core taşıması bitince ölçülerek açılmalı (PATCH semantiğindeki `undefined`/`null` ayrımını yakalar; hazır paket tipleriyle uyumu önce denenmeli).
- Paket bazlı geçersiz kılma (saf çekirdeği derleyici zorlasın):
  - `packages/school-core`, `packages/api-client`: `"types": []`, `"lib": ["es2023"]` — Node ve DOM global'leri kullanılamaz. Bugün kullanılan ortak global'ler (`TextEncoder`, `crypto.randomUUID`; api-client'ta `fetch`) dar bir `globals.d.ts` bildirimiyle veya parametre olarak verilir.
  - `apps/api`: `"types": ["node"]`, `"lib": ["es2023"]`.
  - `apps/web-react`: `"lib": ["es2023", "dom", "dom.iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`, shadcn için `paths: { "@/*": ["./src/*"] }` (Vite `resolve.alias` ile aynı).
  - `apps/mobile`: `expo/tsconfig.base`'i genişletir, tabandaki katı seçenekler tekrar eklenir.
- Birim testler `tests/tsconfig.json` (`types: ["node"]`, `allowJs` yalnız Vue demosunun JS içe aktarmaları için) ile `pnpm typecheck`e dahildir; `tests/e2e-react/tsconfig.json` ayrıdır.

### Prettier

- Mevcut ayarlar korunur (`singleQuote`, `semi: false`, `printWidth: 100`, `trailingComma: all`).
- Tek eklenti önerisi: `prettier-plugin-tailwindcss` (resmi, MIT) — Tailwind sınıf sırası tartışmasını kaldırır; yalnız `apps/web-react` için `overrides` ile. İçe aktarma sıralama eklentisi önerilmez.
- `.prettierignore`'a üretilen dosyalar eklenmeli: `apps/api/drizzle/meta/`, `apps/api/openapi.json`, `packages/api-client/src/schema.d.ts`.

### pnpm

- `pnpm-workspace.yaml`'da `minimumReleaseAge` açık değerle yazılmalı (öneri `1440` dk); şu an yalnız `minimumReleaseAgeExclude` var ve davranış pnpm varsayılanına bağlı.
- Doğrudan bağımlılıklarda `^`/`~` kullanımını yakalayan küçük bir kontrol (`scripts/check-exact-versions`) CI'a eklenmeli; Expo SDK paketleri istisna.

### CI (`.github/workflows/checks.yml`)

- Push tetikleyicisine `docs/**` ve `chore/**` dalları eklenmeli (şu an yalnız `main`, `feature/**`, `fix/**`).
- `concurrency: { group: ${{ github.ref }}, cancel-in-progress: true }`.
- pnpm deposu önbelleği açılmalı (`package-manager-cache: false` kaldırılıp `actions/setup-node` `cache: pnpm`).
- İşler paralel: `static` (format, lint, typecheck) · `unit` (kapsam eşikli) · `api` (PGlite) · `build` (+ paket boyutu kontrolü) · `e2e` (build'e bağlı, gerekirse 2 parça, `retries: 1`, başarısızlıkta rapor ve trace artifact).
- Güvenlik ve sözleşme adımları: `pnpm audit --prod --audit-level high`, `pnpm licenses list --prod` ile izinli lisans kontrolü betiği, gitleaks ile sır taraması, `drizzle-kit check` + migration farkı, `openapi:check` ve `api-client generate:check`, Better Auth şeması üretim farkı.
- Eylemler commit SHA'sına sabitlenmeli; `permissions: contents: read` korunur.
- Gece işi: PostgreSQL 16 ile `test:pg` (eşzamanlılık, pg-boss), dar ekran, koyu tema ve azaltılmış saydamlık e2e projesi, Lighthouse ölçümü.

## Açık sorular

- E-postası olmayan öğrenci girişi (Better Auth `username` eklentisi mi, veli hesabı üzerinden mi).
- Yönetici/finans rolleri için Better Auth `twoFactor` (TOTP) v1 kapsamında mı.
- Web ve API aynı kaynak (ters vekil) mi, alt alan adı mı (çerez ve CSRF ayarı buna bağlı; dağıtım ADR'si).
- Better Auth tablo/kolon adlarının snake_case çoğul eşlemesi tam yapılabiliyor mu; yapılamayanlar istisna listesine.
- React bileşen testi aracı (Vitest + Testing Library mi, yalnız e2e mi).
- PostgreSQL RLS ek savunma olarak v1'e girecek mi (ADR).
- Saklama süreleri, işleme şartları ve `audit_log` saklama süresi (**doğrulanmalı**; `saklama-imha.md`).
- Anlık bildirim (FCM/APNs) ve e-posta/SMS sağlayıcısı için yurt dışı aktarım değerlendirmesi.
- Mevcut Türkçe durum değerleri (`'Aktif'`, `'Onay bekliyor'`) normalleştirmede İngilizce koda çevrilecek mi (domain ekibiyle).
- Saha performans ölçümü (`web-vitals` + kendi ucumuz) ve axe taraması için yeni geliştirme bağımlılıklarının onayı.
