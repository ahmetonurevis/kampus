# Kampüs — okul, veli ve öğrenci platformu

## Amaç ve kapsam

Dil okulları ve özel okullar (ortaokul/lise) için okul–veli–öğrenci arasında köprü kuran, okulun kendi kaynak platformunu oluşturan ve yayınevi/üçüncü taraf dijital platform bağımlılığını azaltan çok kurumlu platform. Sıradan bir LMS'ten fazlası: İngilizcede okuma-anlama, dinleme, yazma ve konuşma becerileri; diğer derslerde ders ve kazanım odaklı çalışma; kayıt, finans, iletişim ve okul iş akışları tek yerde. Canlı ders yayını kapsam dışıdır.

Mimari kararlar `docs/adr/` altındadır; büyük yön değişikliği önce ADR ile yazılır. Temel karar: `docs/adr/0001-platform-mimarisi.md`; hazır paket ilkesi ve tasarım dili: `docs/adr/0002-hazir-paketler-ve-tasarim-dili.md`.

## Geçiş durumu

Proje çevrimdışı Vue/JS demosundan TypeScript, React ve gerçek API'li platforma taşınıyor (ADR 0001):

- Tüm kod TypeScript'e (strict) taşınır. Dokunulan `.js`/`.jsx` dosyası taşınır; Vue dosyaları taşınmaz, yerini React alır.
- Yeni web `apps/web-react` (React 19 + Vite) altında API üzerine yazılır. `apps/web` (Vue) eşitlik sağlanana kadar davranış referansıdır; yeni özellik Vue'ya eklenmez.
- Çevrimdışı demo kalıcılığı (`stores/demo.js`, `lib/demo-persistence.js`, mobil AsyncStorage snapshot'ı) API'ye geçiş bitince silinir; o zamana kadar bozulmadan çalışır.
- Geçiş adımlarının güncel durumu README "Mimari ve kapsam" bölümünde tutulur.

## Mimari

- `packages/school-core`: platformdan bağımsız iş kuralları, Zod şemaları, örnek veri, müfredat, soru bankası, rol/modül kaydı, belge verisi, `content/` (içerik havuzu kuralları), `skills/`, `cefr/`, `platform/` (Oğuzhan'ın komut, menü, yetki ve kapsam tablosu girdileri; ortak `modules/` ve `lib/authorize.ts`/`lib/scope.ts` birleştirir). Web, mobil ve API aynı kuralları çalıştırır.
- `apps/api`: Fastify 5 + TypeScript, PostgreSQL 16, Drizzle. İşlemler school-core kurallarıyla doğrulanır ve tek veritabanı işleminde yazılır. Kurum ve rol kapsamı sunucuda uygulanır; istemciye güvenilmez.
- `packages/api-client` (tipli HTTP istemcisi) ve `packages/react-shared` (ortak React hook'ları) web ile mobil arasında paylaşılır.
- `apps/web-react`: React 19 + TypeScript + Vite. `apps/mobile`: Expo SDK 57, React Native, React Navigation native stack.
- Çok kurumlu: her kayıt bir kuruma aittir. Kurum türü `school` (ders + kazanım) veya `language_school` (CEFR Pre-A1, A1–C2 ve A2+/B1+/B2+ artı seviyeleri + beceri). İngilizce beceri modülleri iki türde de çalışır.
- Para kuruş cinsinden tamsayı; tarihler ISO 8601 UTC, gösterim Europe/Istanbul.
- Form doğrulaması Zod; kullanıcı hataları Türkçe toast/alan mesajı. Teknik hatalar yapılandırılmış logda tutulur, kullanıcıya teknik ayrıntı gösterilmez.
- Örnek kurum Akademi Özel Okulları: öğrenci Deniz Yılmaz; veli Ayşe Yılmaz'ın çocukları Deniz ve Ece; öğretmen Selin Kaya. Örnek dil okulu Kampüs Dil Akademisi.
- Modül kapatıldığında menü, doğrudan route erişimi ve ilgili API uçları kapanır.
- Genel sorunlar için hazır paket kullanılır, kendi kütüphanemiz yazılmaz (ADR 0002 paket listesi): web shadcn/ui (Radix) + Tailwind v4 + TanStack Table/Query + react-hook-form + sonner; API Fastify eklentileri + Drizzle + Better Auth.

## Tasarım ve okul iş kuralları

- Ana renk `#1E3A8A`, aksan `#F97316`; tasarım dili ölçülü Liquid Glass'tır (ADR 0002). Ayrıntı `.claude/rules/tasarim.md`.
- Okul iş akışı, optik/etüt, hedef planı ve arşiv kuralları `.claude/rules/okul-is-akislari.md`.

Klasöre özgü kurallar `.claude/rules/` altındadır ve ilgili dosyalara dokunulduğunda yüklenir; ayrıntılı mühendislik kuralları `docs/muhendislik/`, alan (iş) kuralları `docs/domain/`, ürün ister listesi ve yol haritası `docs/urun/ister-listesi.md` içindedir. Mobil kurallar ayrıca `apps/mobile/CLAUDE.md` ve `apps/mobile/AGENTS.md` içindedir.

## İki geliştiriciyle çalışma

İki geliştirici (Oğuzhan, Onur) paralel çalışır; ilke: izin yok, görünürlük var. Alan, dal, görev tablosu, issue, entegrasyon ve yasaklar `.claude/rules/ortak-calisma.md` ve `docs/muhendislik/git-ve-surum.md` §7'dedir; diğer geliştiricinin alanına yazılmaz. Skill'ler: `is-baslat`, `entegre-et`.

## Claude Code ile çalışma

- İş başlamadan kapsam, adımlar ve etkilenecek dosyalar belirlenir. Tamamlanmış geçici planlar bu dosyada biriktirilmez; kalıcı kararlar ADR'ye, kurallar `.claude/rules/`'a yazılır.
- Doğrulama merdiveni `dogrula` skill'indedir; değişiklik ilgili testler ve lint/format/typecheck geçmeden bitmiş sayılmaz.
- Yeni modül `yeni-modul`, API ucu `api-ucu`, TypeScript taşıma `ts-tasima`, görsel kontrol `ekran-kontrol` skill'iyle yapılır. Diff incelemesi `inceleyici`, uzun test koşusu `dogrulayici`, görev uygulama `kampus-gelistirici` ajanıyla yapılabilir.
- Commit mesajı standardı `docs/muhendislik/git-ve-surum.md` §2'dedir ve `commit-msg` hook'u denetler: başlık Türkçe, emir kipinde, en çok 72 karakter, noktasız ve öneksiz; görev ID'si başlık sonunda ("Hedef ve gelişim planı modülünü ekle (OG-004)"); sonda `Co-Authored-By`. Bir commit tek mantıksal değişikliktir ve yeşildir.
- Mimari, komut veya klasör yapısı değişince bu dosya, ilgili `.claude/rules/` dosyası ve README aynı committe güncellenir.

## Komutlar ve teslimler

`pnpm dev` (Vue, 5173), `pnpm dev:react` (React, 5174), `pnpm dev:api`, `pnpm build` (Vue + React), `pnpm size` (React web gzip paket bütçesi; önce React derlemesi), `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` (Claude hook'ları), `pnpm gen` (OpenAPI + api-client şeması), `pnpm test:e2e` (Vue demosu), `pnpm test:e2e:react` (React web + API, `kampus_e2e` veritabanı), `pnpm mobile`, `pnpm build:apk`. API: `docker compose up -d` (PostgreSQL 16, port 5433; dosya taraması için isteğe bağlı `docker compose --profile clamav up -d` ve `FILE_SCANNER=clamav`), `pnpm --filter @kampus/api <test|db:migrate|db:seed|db:generate|auth:schema|openapi|openapi:check>`; ortam `apps/api/.env.example` (arka plan iş kuyruğu `JOBS_ENABLED`; testte kapalı).

Android teslim bilgileri `docs/mobile-release.md`, sayfa rehberi `docs/sayfalar.md`, yatırımcı sunumu `sunumlar/` (üretim: `sunumlar/OKU.md`). Statik yayın (`pnpm run deploy`, `demo.onurevis.com`) backend'siz demoya aittir; API yayını ayrı ADR ile planlanır. Geçici build/cache/rapor klasörleri, eski APK'lar ve yinelenen sunum kopyaları tutulmaz; ortam dosyaları, lockfile ve imzalama bilgileri temizliğe dahil edilmez.

## Tamamlanma ölçütü

Belirtilen sayfalar gezilebilir; listeler arama/filtre/sayfalama içerir; işlemler doğru kurum/rol/sınıf/öğrenciye yansır. Ödeme mükerrer yapılmaz, quiz puanı cevaplardan hesaplanır, yoklama yinelenmez. Lint, format, typecheck, test ve build CI'da yeşildir; README doğrulama sayıları yalnız teslimde güncellenir.
