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

Klasöre özgü kurallar `.claude/rules/` altındadır ve ilgili dosyalara dokunulduğunda yüklenir; ayrıntılı mühendislik kuralları `docs/muhendislik/`, alan (iş) kuralları `docs/domain/`, ürün ister listesi ve yol haritası `docs/urun/ister-listesi.md` içindedir. Mobil kurallar ayrıca `apps/mobile/CLAUDE.md` ve `apps/mobile/AGENTS.md` içindedir.

## Okul iş akışları ve iş kuralları

- Okul iş akışı modülleri web, mobil ve API'de aynı `school-core` tanımlarını kullanır: `modules/school-workflows.ts` modül kaydı, `lib/school-workflows.ts` Zod doğrulaması, rol kapsamı ve atomik işlemler, `lib/workflow-presentation.ts` ortak liste/form/detay tanımları. Menü `modules/full-navigation.ts` ile paylaşılır. Mobil karşılıklar `WorkflowScreen.tsx`, `OpticalScreen.tsx`, `TutoringScreen.tsx`.
- İşlemler atomiktir: önce kalıcı yazılır, sonra state değişir; başarısızlıkta hiçbir kayıt değişmez. Snapshot sürümü 3 ve eski kayıtlar demo kalıcılığı silinene kadar korunur.
- Yenileme planlama ve sınıf geçişi ayrı işlemlerdir. Sözleşme `invoiceIds` ile yalnızca kendi taksitlerini çözümler. Rehberlik iç notlarını yalnız rehberlik görevli öğretmen görür; yönetici, ön büro, veli ve öğrenci görmez (DOM-YTK-020). İptal dersleri günlük programlarda görünmez.
- Optik/etüt doğrulaması `lib/assessment-automation.ts`, CSV ayrıştırması `lib/delimited-input.ts`, rezervasyon çakışmaları `lib/tutor-conflicts.ts` içindedir. Okuyucu CSV/DAT/TXT çıktısı kullanılır; cevap anahtarının her sorusu ders/kazanıma bağlıdır. Anahtar revizyonu veya manuel sonuç değişikliği eski optik analizin kullanımını engeller.
- Etütler öğretmen uygunluk saatlerini kullanır; kampüs/düzey/ders/kazanım grupları kapasite ve zaman çakışmalarıyla yerleştirilir. Önizleme saf işlemdir; son onay güncel planı yeniden hesaplar. İptal/yoklama geçmişi korunur; öğrenci/veli etüt verisi kendi kapsamına daraltılır.
- Hedef & gelişim planı (`goals`, `studentGoals`): ilerleme deneme sonuçlarından hesaplanır, saklanmaz. Öğrenci hedefi `Onay bekliyor` açar; yönetici/branş öğretmeni onaylar veya gerekçeyle reddeder; veli yalnızca yorum ekler. Aynı öğrenci ve kapsam için tek açık hedef bulunur. Kullanım: `docs/hedef-gelisim-plani.md`.
- Gelecek etüt rezervasyonu modül kapanınca kaybolmaz; çakışan ders/randevu/etkinlik ve bağlı kaydın arşivi engellenir. Dönem geçişinden önce öğrencinin ileri tarihli etütleri iptal edilir. Kullanım: `docs/optik-degerlendirme-etut.md`.
- Kampüs/sınıf/kadro arşivinde bağlı kayıtlar güvenli aktarılır; geçmiş finans/not/yoklama korunur. Yetersiz kontenjan, branş ve program çakışmaları engellenir. Arşivden geri almak aktarılan görevleri otomatik geri taşımaz.

## Kalıcı tasarım ve davranış kuralları

- Ana renk `#1E3A8A`, aksan `#F97316`, web açık zemini `#FFFFFF`; mobilde sayfa zemini yumuşak mavi-gri `#EFF3FB`, kartlar beyaz, üst başlık safirdir. Açık/koyu tema birlikte bulunur; varsayılan açık, mobilde sistem seçeneği de vardır. Tema tercihi saklanır.
- Tasarım dili ölçülü Liquid Glass'tır (ADR 0002). Cam yalnız içeriğin üstünde yüzen gezinme/kontrol katmanında kullanılır: sidebar, navbar, menü, popover, modal/sağ panel zemini, toast ve mobil üst başlık. Tablo, form, belge ve metin yüzeyleri opaktır. Kontrast WCAG AA'dır; azaltılmış saydamlık, yüksek kontrast ve desteksiz ortamda yüzey opak zemine döner. Gradyan zemin, ışık hüzmesi, yoğun gölge, dekoratif renkli kenar, kırılma efekti ve veriye dayanmayan grafik kullanılmaz. İnce ayraçlar, düzenli boşluklar, eş merkezli yuvarlak köşeler ve okunaklı metin esastır.
- Genel sorunlar için hazır paket kullanılır, kendi kütüphanemiz yazılmaz (ADR 0002 paket listesi): web shadcn/ui (Radix) + Tailwind v4 + TanStack Table/Query + react-hook-form + sonner; API Fastify eklentileri + Drizzle + Better Auth.
- Hızlı erişim bölümü, navbar hızlı araması ve mobil alt navigasyon yoktur. Beş rolde kategorili menü kullanılır; kapalı modüller ve boş kategoriler gizlenir. Mobilde hamburger menü yoktur: ana ekranda kategoriler kart olarak gelir, karta dokununca kategori ekranı modülleri kart olarak listeler. Hesap sayfaları sağ üstteki isim/avatar menüsündedir; öğrenci ödemeleri telefonda gösterilmez.
- Web sidebar/navbar iç boşluklu yüzeylerdir; aktif bağlantı kısa pill, breadcrumb ve kontroller ayrıdır. Tema ve ölçüler tek token dosyasından gelir. Sidebar bağlantıları 11 px, grup etiketleri 10 px.
- Ana işlem görünür, ikincil işlemler sakin tutulur. Dashboard içerikleri 2:1; mini grafikler yalnızca gerçek kayıtlardan türetilir. Avatar rengi normalleştirilmiş tam ada göre sabittir.
- Masaüstü tablolarda sabit başlık/işlem sütunu, mobilde temel bilgiler ve açılan ayrıntılar kullanılır. Arama/filtre/sıralama/sayfa ve kaydırma konumu liste/çocuk bazında korunur. Filtre değişince sayfa ve konum sıfırlanır; veri azalınca geçersiz sayfada kalınmaz. CSV tüm filtrelenmiş/sıralanmış sonuçları içerir.
- Öğrenci/ödeme/sınıf özetleri ve kısa formlar sağ panel; uzun kayıt/sınıf formları ve PDF geniş alanda açılır. Liste bağlamı, URL geri/ileri, klavye odağı ve iç içe pencereler korunur.
- Dekont, sözleşme, taksit taahhütnamesi, materyal, ödev ve değerlendirme PDF'leri belge türüne özel şablon kullanır. Türkçe font, çok sayfalı içerik, tekrarlanan tablo başlığı, belge/sayfa numarası ve safir/turuncu marka düzeni korunur. PDF önizlemesi belge açıldığında yüklenir; indirme/yazdırma aynı PDF'yi kullanır; geçici URL'ler kapanışta temizlenir.
- Girişin 3B hareketi ve okunaklı KAMPÜS yazısı korunur; azaltılmış hareket/görünmeyen sekme desteklenir.
- Erişilebilir etiket, klavye odağı, azaltılmış hareket, dar/yatay ekran zorunludur. Mobil dokunma hedefi en az 48 dp; büyük yazı ve klavye açıkken alan/işlem görünür kalır.

## İki geliştiriciyle çalışma

İki geliştirici (Oğuzhan, Onur) paralel çalışır. İlke: izin yok, görünürlük var; kendi alanında herkes sormadan yazar, birleştirir, gönderir; iş görev tablosunda görünür. Yalnız sahiplik/kural değişikliği ve ürün-hukuk-maliyet kararları birlikte alınır. Alan haritası `.claude/alanlar.json`; ayrıntı `docs/muhendislik/git-ve-surum.md` §7 ve `.claude/rules/ortak-calisma.md`; skill'ler `is-baslat`, `entegre-et`.

- Görev tabloları `docs/is-bolumu/<sahip>.md` (ID'li, dalgalı), yalnız sahibi düzenler. Yeni makinede ve yeni klonda önce [ilk kurulum](docs/is-bolumu/ilk-kurulum.md).
- Dal `onur/<konu>` veya `oguzhan/<konu>`, güncel `origin/feature/platform-gecisi`'nden açılır; oturum başında entegrasyon dala birleştirilir. Küçük birim yeşil olunca hemen entegrasyona; uzun yaşayan dal yok.
- Görev durumu tabloda tutulur, issue'da değil (`bekliyor`, `çalışılıyor`, `revizyon`, `engelli`, `bitti`, `iptal`). Başlarken (`is-baslat`) satır `çalışılıyor` + dal adı, bitince (`entegre-et`) `bitti` + birleştirme hash'i; değişiklik entegrasyon dalında tek satırlık commit'tir ve oturum tarafından gönderilir. Çakışan iş için karşı tablonun `çalışılıyor` satırlarına bakılır; varsa durulur, kullanıcıya sorulur. Migration/ADR numarası satırın Not'una (onay beklenmez). Commit/merge mesajı görev ID'sini anar.
- Diğer geliştiricinin alanına yazılmaz (`alan-koruma` hook'u engeller); durmadan onun `sahip:` etiketiyle iş isteği issue'su açılır ve kendi taraf geçici veriyle yazılır. Ortak dosyada kendi bloğuna yazılır; blok dışına çıkılırsa görev satırının Not'una yazılır, beklenmez. Issue yalnız karşı taraftan iş isteği ve hata bildirimidir.
- Entegrasyondan önce: fetch + entegrasyonu dala birleştir, `pnpm gen`, dokunulan paketlerin format/lint/typecheck ve ilgili birim/API testleri, `git merge-tree` ölçümü; birleştirme `--no-ff`. Tam set ve e2e CI'da; CI'ı kıran ilk iş düzeltir ya da geri alır.
- Sürüm ve README test sayıları yalnız teslimde; davranış değişikliği `changes/<konu>.md` parçası yazar, iç paketler `workspace:*`.
- Yasak: force push; gönderilmiş commit'te amend, rebase veya reset; `main`'e push (`push-kontrol` hook'u ve izin ayarı engeller).

## Claude Code ile çalışma

- İş başlamadan kapsam, adımlar ve etkilenecek dosyalar belirlenir. Tamamlanmış geçici planlar bu dosyada biriktirilmez; kalıcı kararlar ADR'ye, kurallar `.claude/rules/`'a yazılır.
- Doğrulama merdiveni `dogrula` skill'indedir; değişiklik ilgili testler ve lint/format/typecheck geçmeden bitmiş sayılmaz.
- Yeni modül `yeni-modul`, API ucu `api-ucu`, TypeScript taşıma `ts-tasima`, görsel kontrol `ekran-kontrol` skill'iyle yapılır. Diff incelemesi `inceleyici`, uzun test koşusu `dogrulayici`, görev uygulama `kampus-gelistirici` ajanıyla yapılabilir.
- Commit mesajı standardı `docs/muhendislik/git-ve-surum.md` §2'dedir ve `commit-msg` hook'u denetler: başlık Türkçe, emir kipinde, büyük harfle, en çok 72 karakter, noktasız ve öneksiz; görev ID'si başlık sonunda parantezde ya da gövdede ("Hedef ve gelişim planı modülünü ekle (OG-004)"); gövdede neden ve etki; durum commit'i "Görev durumunu güncelle: OG-012 bitti", merge gövdesi "OG-012: <özet>"; sonda `Co-Authored-By`. Bir commit tek mantıksal değişikliktir ve yeşildir.
- Mimari, komut veya klasör yapısı değişince bu dosya, ilgili `.claude/rules/` dosyası ve README aynı committe güncellenir.

## Komutlar ve teslimler

`pnpm dev` (Vue, 5173), `pnpm dev:react` (React, 5174), `pnpm dev:api`, `pnpm build` (Vue + React), `pnpm size` (React web gzip paket bütçesi; önce React derlemesi), `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` (Claude hook'ları), `pnpm gen` (OpenAPI + api-client şeması), `pnpm test:e2e` (Vue demosu), `pnpm test:e2e:react` (React web + API, `kampus_e2e` veritabanı), `pnpm mobile`, `pnpm build:apk`. API: `docker compose up -d` (PostgreSQL 16, port 5433; dosya taraması için isteğe bağlı `docker compose --profile clamav up -d` ve `FILE_SCANNER=clamav`), `pnpm --filter @kampus/api <test|db:migrate|db:seed|db:generate|auth:schema|openapi|openapi:check>`; ortam `apps/api/.env.example` (arka plan iş kuyruğu `JOBS_ENABLED`; testte kapalı).

Android teslim bilgileri `docs/mobile-release.md`, sayfa rehberi `docs/sayfalar.md`, yatırımcı sunumu `sunumlar/` (üretim: `sunumlar/OKU.md`). Mevcut statik yayın (`pnpm run deploy`, `demo.onurevis.com`) backend'siz demoya aittir; API yayını ayrı ADR ile planlanır. Geçici build/cache/rapor klasörleri, eski APK'lar ve yinelenen sunum kopyaları tutulmaz; ortam dosyaları, lockfile ve imzalama bilgileri temizliğe dahil edilmez.

## Tamamlanma ölçütü

Belirtilen sayfalar gezilebilir; listeler arama/filtre/sayfalama içerir; işlemler doğru kurum/rol/sınıf/öğrenciye yansır. Ödeme mükerrer yapılmaz, quiz puanı cevaplardan hesaplanır, yoklama yinelenmez. Lint, format, typecheck, test ve build CI'da yeşildir; README doğrulama sayıları yalnız teslimde güncellenir.
