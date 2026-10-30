# Kampüs — okul, veli ve öğrenci platformu

## Amaç ve kapsam

Dil okulları ve özel okullar (ortaokul/lise) için okul–veli–öğrenci arasında köprü kuran, okulun kendi kaynak platformunu oluşturan ve yayınevi/üçüncü taraf dijital platform bağımlılığını azaltan çok kurumlu platform. Sıradan bir LMS'ten fazlası: İngilizcede okuma-anlama, dinleme, yazma ve konuşma becerileri; diğer derslerde ders ve kazanım odaklı çalışma; kayıt, finans, iletişim ve okul iş akışları tek yerde. Canlı ders yayını kapsam dışıdır.

Mimari kararlar `docs/adr/` altındadır; büyük yön değişikliği önce ADR ile yazılır. Temel karar: `docs/adr/0001-platform-mimarisi.md`.

## Geçiş durumu

Proje çevrimdışı Vue/JS demosundan TypeScript, React ve gerçek API'li platforma taşınıyor (ADR 0001):

- Tüm kod TypeScript'e (strict) taşınır. Dokunulan `.js`/`.jsx` dosyası taşınır; Vue dosyaları taşınmaz, yerini React alır.
- Yeni web `apps/web-react` (React 19 + Vite) altında API üzerine yazılır. `apps/web` (Vue) eşitlik sağlanana kadar davranış referansıdır; yeni özellik Vue'ya eklenmez.
- Çevrimdışı demo kalıcılığı (`stores/demo.js`, `lib/demo-persistence.js`, mobil AsyncStorage snapshot'ı) API'ye geçiş bitince silinir; o zamana kadar bozulmadan çalışır.
- Geçiş adımlarının güncel durumu README "Mimari ve kapsam" bölümünde tutulur.

## Mimari

- `packages/school-core`: platformdan bağımsız iş kuralları, Zod şemaları, örnek veri, müfredat, soru bankası, rol/modül kaydı, belge verisi. Web, mobil ve API aynı kuralları çalıştırır.
- `apps/api`: Fastify 5 + TypeScript, PostgreSQL 16, Drizzle. İşlemler school-core kurallarıyla doğrulanır ve tek veritabanı işleminde yazılır. Kurum ve rol kapsamı sunucuda uygulanır; istemciye güvenilmez.
- `packages/api-client` (tipli HTTP istemcisi) ve `packages/react-shared` (ortak React hook'ları) web ile mobil arasında paylaşılır.
- `apps/web-react`: React 19 + TypeScript + Vite. `apps/mobile`: Expo SDK 57, React Native, React Navigation native stack.
- Çok kurumlu: her kayıt bir kuruma aittir. Kurum türü `school` (ders + kazanım) veya `language_school` (CEFR A1–C2 + beceri). İngilizce beceri modülleri iki türde de çalışır.
- Para kuruş cinsinden tamsayı; tarihler ISO 8601 UTC, gösterim Europe/Istanbul.
- Form doğrulaması Zod; kullanıcı hataları Türkçe toast/alan mesajı. Teknik hatalar yapılandırılmış logda tutulur, kullanıcıya teknik ayrıntı gösterilmez.
- Örnek kurum Akademi Özel Okulları: öğrenci Deniz Yılmaz; veli Ayşe Yılmaz'ın çocukları Deniz ve Ece; öğretmen Selin Kaya. Örnek dil okulu Kampüs Dil Akademisi.
- Modül kapatıldığında menü, doğrudan route erişimi ve ilgili API uçları kapanır.

Klasöre özgü kurallar `.claude/rules/` altındadır ve ilgili dosyalara dokunulduğunda yüklenir. Mobil kurallar ayrıca `apps/mobile/CLAUDE.md` ve `apps/mobile/AGENTS.md` içindedir.

## Okul iş akışları ve iş kuralları

- Okul iş akışı modülleri web, mobil ve API'de aynı `school-core` tanımlarını kullanır: `modules/school-workflows.js` modül kaydı, `lib/school-workflows.js` Zod doğrulaması, rol kapsamı ve atomik işlemler, `lib/workflow-presentation.js` ortak liste/form/detay tanımları. Menü `modules/full-navigation.js` ile paylaşılır. Mobil karşılıklar `WorkflowScreen.jsx`, `OpticalScreen.jsx`, `TutoringScreen.jsx`.
- İşlemler atomiktir: önce kalıcı yazılır, sonra state değişir; başarısızlıkta hiçbir kayıt değişmez. Snapshot sürümü 3 ve eski kayıtlar demo kalıcılığı silinene kadar korunur.
- Yenileme planlama ve sınıf geçişi ayrı işlemlerdir. Sözleşme `invoiceIds` ile yalnızca kendi taksitlerini çözümler. Rehberlik iç notları veli/öğrenciye gösterilmez. İptal dersleri günlük programlarda görünmez.
- Optik/etüt doğrulaması `lib/assessment-automation.js`, CSV ayrıştırması `lib/delimited-input.js`, rezervasyon çakışmaları `lib/tutor-conflicts.js` içindedir. Okuyucu CSV/DAT/TXT çıktısı kullanılır; cevap anahtarının her sorusu ders/kazanıma bağlıdır. Anahtar revizyonu veya manuel sonuç değişikliği eski optik analizin kullanımını engeller.
- Etütler öğretmen uygunluk saatlerini kullanır; kampüs/düzey/ders/kazanım grupları kapasite ve zaman çakışmalarıyla yerleştirilir. Önizleme saf işlemdir; son onay güncel planı yeniden hesaplar. İptal/yoklama geçmişi korunur; öğrenci/veli etüt verisi kendi kapsamına daraltılır.
- Hedef & gelişim planı (`goals`, `studentGoals`): ilerleme deneme sonuçlarından hesaplanır, saklanmaz. Öğrenci hedefi `Onay bekliyor` açar; yönetici/branş öğretmeni onaylar veya gerekçeyle reddeder; veli yalnızca yorum ekler. Aynı öğrenci ve kapsam için tek açık hedef bulunur. Kullanım: `docs/hedef-gelisim-plani.md`.
- Gelecek etüt rezervasyonu modül kapanınca kaybolmaz; çakışan ders/randevu/etkinlik ve bağlı kaydın arşivi engellenir. Dönem geçişinden önce öğrencinin ileri tarihli etütleri iptal edilir. Kullanım: `docs/optik-degerlendirme-etut.md`.
- Kampüs/sınıf/kadro arşivinde bağlı kayıtlar güvenli aktarılır; geçmiş finans/not/yoklama korunur. Yetersiz kontenjan, branş ve program çakışmaları engellenir. Arşivden geri almak aktarılan görevleri otomatik geri taşımaz.

## Kalıcı tasarım ve davranış kuralları

- Ana renk `#1E3A8A`, aksan `#F97316`, web açık zemini `#FFFFFF`; mobilde sayfa zemini yumuşak mavi-gri `#EFF3FB`, kartlar beyaz, üst başlık safirdir. Açık/koyu tema birlikte bulunur; varsayılan açık, mobilde sistem seçeneği de vardır. Tema tercihi saklanır.
- Gradyan, cam efekti, ışık hüzmesi, yoğun gölge, dekoratif renkli kenar çizgisi veya veriye dayanmayan grafik kullanılmaz. İnce ayraçlar, düzenli boşluklar, ölçülü yuvarlak köşeler ve okunaklı metin esastır.
- Hızlı erişim bölümü, navbar hızlı araması ve mobil alt navigasyon yoktur. Beş rolde kategorili menü kullanılır; kapalı modüller ve boş kategoriler gizlenir. Mobilde hamburger menü yoktur: ana ekranda kategoriler kart olarak gelir, karta dokununca kategori ekranı modülleri kart olarak listeler. Hesap sayfaları sağ üstteki isim/avatar menüsündedir; öğrenci ödemeleri telefonda gösterilmez.
- Web sidebar/navbar iç boşluklu yüzeylerdir; aktif bağlantı kısa pill, breadcrumb ve kontroller ayrıdır. Tema ve ölçüler tek token dosyasından gelir. Sidebar bağlantıları 11 px, grup etiketleri 10 px.
- Ana işlem görünür, ikincil işlemler sakin tutulur. Dashboard içerikleri 2:1; mini grafikler yalnızca gerçek kayıtlardan türetilir. Avatar rengi normalleştirilmiş tam ada göre sabittir.
- Masaüstü tablolarda sabit başlık/işlem sütunu, mobilde temel bilgiler ve açılan ayrıntılar kullanılır. Arama/filtre/sıralama/sayfa ve kaydırma konumu liste/çocuk bazında korunur. Filtre değişince sayfa ve konum sıfırlanır; veri azalınca geçersiz sayfada kalınmaz. CSV tüm filtrelenmiş/sıralanmış sonuçları içerir.
- Öğrenci/ödeme/sınıf özetleri ve kısa formlar sağ panel; uzun kayıt/sınıf formları ve PDF geniş alanda açılır. Liste bağlamı, URL geri/ileri, klavye odağı ve iç içe pencereler korunur.
- Dekont, sözleşme, taksit taahhütnamesi, materyal, ödev ve değerlendirme PDF'leri belge türüne özel şablon kullanır. Türkçe font, çok sayfalı içerik, tekrarlanan tablo başlığı, belge/sayfa numarası ve safir/turuncu marka düzeni korunur. PDF önizlemesi belge açıldığında yüklenir; indirme/yazdırma aynı PDF'yi kullanır; geçici URL'ler kapanışta temizlenir.
- Girişin 3B hareketi ve okunaklı KAMPÜS yazısı korunur; azaltılmış hareket/görünmeyen sekme desteklenir.
- Erişilebilir etiket, klavye odağı, azaltılmış hareket, dar/yatay ekran zorunludur. Mobil dokunma hedefi en az 48 dp; büyük yazı ve klavye açıkken alan/işlem görünür kalır.

## Claude Code ile çalışma

- İş başlamadan kapsam, adımlar ve etkilenecek dosyalar belirlenir. Tamamlanmış geçici planlar bu dosyada biriktirilmez; kalıcı kararlar ADR'ye, kurallar `.claude/rules/`'a yazılır.
- Doğrulama merdiveni `dogrula` skill'indedir; değişiklik ilgili testler ve lint/format/typecheck geçmeden bitmiş sayılmaz.
- Yeni modül `yeni-modul`, API ucu `api-ucu`, TypeScript taşıma `ts-tasima`, görsel kontrol `ekran-kontrol` skill'iyle yapılır. Diff incelemesi `inceleyici`, uzun test koşusu `dogrulayici`, görev uygulama `kampus-gelistirici` ajanıyla yapılabilir.
- Commit başlığı Türkçe, emir kipinde ve kısa ("Hedef ve gelişim planı modülünü ekle"); gövdede neden ve etki. Bir commit tek mantıksal değişikliktir ve yeşildir.
- Mimari, komut veya klasör yapısı değişince bu dosya, ilgili `.claude/rules/` dosyası ve README aynı committe güncellenir.

## Komutlar ve teslimler

`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm mobile`, `pnpm build:apk`. API komutları `apps/api/package.json` içindedir.

Android teslim bilgileri `docs/mobile-release.md`, sayfa rehberi `docs/sayfalar.md`, yatırımcı sunumu `sunumlar/` (üretim: `sunumlar/OKU.md`). Mevcut statik yayın (`pnpm run deploy`, `demo.onurevis.com`) backend'siz demoya aittir; API yayını ayrı ADR ile planlanır. Geçici build/cache/rapor klasörleri, eski APK'lar ve yinelenen sunum kopyaları tutulmaz; ortam dosyaları, lockfile ve imzalama bilgileri temizliğe dahil edilmez.

## Tamamlanma ölçütü

Belirtilen sayfalar gezilebilir; listeler arama/filtre/sayfalama içerir; işlemler doğru kurum/rol/sınıf/öğrenciye yansır. Ödeme mükerrer yapılmaz, quiz puanı cevaplardan hesaplanır, yoklama yinelenmez. Lint, format, typecheck, test ve build sonuçları README'de güncel tutulur.
