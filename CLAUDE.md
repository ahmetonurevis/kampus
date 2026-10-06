# Kampüs — Akademi Özel Okulları

## Amaç ve kapsam

Vue 3 web paneli ve React Native Android uygulamasıyla beş rolün tüm Faz 1 ve Faz 2 sayfalarını kapsayan, backend ve veritabanı olmadan çalışan Türkçe LMS/ERP demosu. Canlı ders yayını kapsam dışıdır. Gerçek kimlik doğrulama, gerçek tahsilat, SMS/e-posta veya dosya sunucusu bulunmaz.

## Çalışma yöntemi

İş başlamadan kapsam, adımlar ve etkilenecek dosyalar belirlenir. Proje genel geliştirme kurallarına tabidir. Tamamlanmış geçici çalışma planları bu dosyada biriktirilmez; güncel mimari ve kalıcı kararlar tutulur. Özellik/iş mantığı değişiklikleri kaynaklarda, yeniden üretilebilen çıktılar `artifacts/` altında yer alır.

## Mimari

- `apps/web`: Vue 3 Composition API, Vue Router, Vite.
- `src/data`: tarihleri başlangıç gününe göre üretilen deterministik veri.
- `src/stores`: ortak reaktif state, kalıcılık ve doğrulanmış işlemler.
- `src/modules`: modül sınırları ve role göre sayfa kaydı.
- `src/views`: iş akışları; `src/components`: tekrar kullanılan erişilebilir bileşenler.
- `src/lib`: Türkçe tarih/para formatı, indirme ve doğrulama yardımcıları.
- Demo istisnası: modül durumları DB yerine mock store'da, rol seçimi JWT yerine tarayıcı oturumunda tutulur. API, migration veya gerçek sunucu bağlantısı eklenmez.
- Para kuruş cinsinden tamsayı; tarihler ISO 8601 UTC, gösterim Europe/Istanbul.
- Form doğrulaması zod; kullanıcı hataları Türkçe toast/alan mesajı. Teknik hatalar merkezi yapılandırılmış yerel logda tutulur.
- Öğrenci oturumu Deniz Yılmaz; veli Ayşe Yılmaz'ın çocukları Deniz ve Ece; öğretmen Selin Kaya.
- Modül kapatıldığında menü ve doğrudan route erişimi kapanır.

## Web okul iş akışları

- Bu genişletme yalnızca web kapsamındadır; mobil menü ve ekranlarına yeni özellik eklenmez.
- Okul iş akışları: `packages/school-core/src/modules/school-workflows.js` on bir bağımsız modülü; `lib/school-workflows.js` Zod doğrulaması, rol kapsamı ve atomik işlemleri; `lib/workflow-presentation.js` ortak liste/form/detay tanımlarını içerir. İlk sekiz özellik servis/yemek ayrımıyla dokuz modüldür; optik değerlendirme ve otomatik etüt iki ek modüldür. Backend eklenmez.
- Yeni web işlemleri `transaction` ile önce depolamaya yazılır, sonra reaktif state değişir. Snapshot sürümü 3 ve eski kayıtlar korunur; restore yeni modül varsayılanlarını eski tercihlerle birleştirir.
- Yenileme planlama ve sınıf geçişi ayrı işlemlerdir. Sözleşme `invoiceIds` ile yalnızca kendi taksitlerini çözümler. Rehberlik iç notları veli/öğrenciye gösterilmez. İptal dersleri günlük programlarda görünmez.

- Optik/etüt doğrulaması `lib/assessment-automation.js`, CSV ayrıştırması `lib/delimited-input.js`, rezervasyon çakışmaları `lib/tutor-conflicts.js` içindedir. Okuyucu CSV/DAT/TXT çıktısı kullanılır; profil cevap anahtarının her sorusu ders/kazanıma bağlıdır. Anahtar revizyonu veya manuel sonuç değişikliği eski optik analizin kullanımını engeller.
- Etütler mevcut öğretmen uygunluk saatlerini kullanır; kampüs/düzey/ders/kazanım grupları kapasite ve zaman çakışmalarıyla yerleştirilir. Önizleme saf işlemdir; son onay güncel planı yeniden hesaplar. İptal/yoklama geçmişi korunur; öğrenci/veli etüt katılımcıları, puanları ve yoklamaları kendi kapsamına daraltılır.
- Gelecek etüt rezervasyonu modül kapanınca kaybolmaz; çakışan ders/randevu/etkinlik ve bağlı kaydın arşivi engellenir. Dönem geçişinden önce öğrencinin ileri tarihli etütleri iptal edilir. Kullanım: `docs/optik-degerlendirme-etut.md`.

## Ortak mobil yapı

- `apps/mobile`: React Native / Expo SDK 57, React Navigation native stack ve AsyncStorage. Mobil kurallar `apps/mobile/AGENTS.md` ve `apps/mobile/CLAUDE.md` içindedir.
- `packages/school-core`: Vue/DOM bağımsız başlangıç verisi, ders kataloğu, rol/modül kaydı, finans/puanlama/yönetim kuralları ve belge verileri. Web uyumluluk katmanı korunur.
- Beş rol bütün mevcut modüllere aynı kategori menüsünden erişir. Web ve telefon ayrı yerel kayıtlardır; canlı eşzamanlılık yoktur.
- Expo Go gerektirmeyen, çevrimdışı çalışan imzalı APK üretilir. İki video ve belge fontları paketlenir. Native ayarlar `app.json` ve config plugin üzerinden yeniden üretilebilir olmalıdır.
- Güncel APK yalnızca APK içeren `apklar/` klasöründedir; imzalama anahtarı proje dışında kalır. Aynı uygulama kimliği, imza ve yerel veri biçimiyle güncellenir.

## Kalıcı tasarım ve davranış kuralları

- Akademi Özel Okulları; ortaokul/lise, bütün dersler. İngilizce yalnızca bir derstir; dil kursu/CEFR yerine ders ve kazanım gelişimi kullanılır.
- Ana renk `#1E3A8A`, aksan `#F97316`, açık zemin `#FFFFFF`. Açık/koyu tema birlikte bulunur; varsayılan açık, mobilde sistem seçeneği de vardır. Tema tercihi saklanır.
- Gradyan, cam efekti, ışık hüzmesi, yoğun gölge, dekoratif renkli kenar çizgisi veya veriye dayanmayan grafik kullanılmaz. İnce ayraçlar, düzenli boşluklar, ölçülü yuvarlak köşeler ve okunaklı metin esastır.
- Hızlı erişim bölümü, navbar hızlı araması ve mobil alt navigasyon yoktur. Beş rolde kategorili menü kullanılır; kapalı modüller ve boş kategoriler gizlenir. Aktif kategori görünür, tercihler rol bazında saklanır.
- Web sidebar/navbar iç boşluklu yüzeylerdir; aktif bağlantı kısa pill, breadcrumb ve kontroller ayrıdır. `apps/web/src/styles/tokens.css` tema/ölçüleri, `presentation.css` ortak yerleşimi tanımlar. Sidebar bağlantıları 11 px, grup etiketleri 10 px; genel metin azaltımı token üzerinden yapılır.
- Ana işlem görünür, ikincil işlemler sakin tutulur. Dashboard içerikleri 2:1; mini grafikler yalnızca gerçek örnek kayıtlardan türetilir. Avatar rengi normalleştirilmiş tam ada göre sabittir.
- Masaüstü tablolarda sabit başlık/işlem sütunu, mobilde temel bilgiler ve açılan ayrıntılar kullanılır. Arama/filtre/sıralama/sayfa ve kaydırma konumu liste/çocuk bazında korunur. Filtre değişince sayfa ve konum sıfırlanır; veri azalınca geçersiz sayfada kalınmaz. CSV tüm filtrelenmiş/sıralanmış sonuçları içerir.
- Öğrenci/ödeme/sınıf özetleri ve kısa formlar sağ panel; uzun kayıt/sınıf formları ve PDF geniş alanda açılır. Liste bağlamı, URL geri/ileri, klavye odağı ve iç içe pencereler korunur.
- Dekont, sözleşme, taksit taahhütnamesi, materyal, ödev ve değerlendirme PDF'leri belge türüne özel şablon kullanır. Türkçe font, çok sayfalı içerik, tekrarlanan tablo başlığı, belge/sayfa numarası ve safir/turuncu marka düzeni korunur.
- PDF.js önizlemesi ve worker belge açıldığında yüklenir; indirme/yazdırma aynı gerçek PDF'yi kullanır. Geçici URL/kaynaklar kapanışta temizlenir; hata/yeniden deneme ve odak dönüşü çalışır.
- Girişin 3B hareketi ve okunaklı KAMPÜS yazısı korunur; azaltılmış hareket/görünmeyen sekme desteklenir. Oynat/durdur düğmesi kullanıcının isteğiyle yorum satırında kalır.
- Erişilebilir etiket, klavye odağı, azaltılmış hareket, dar/yatay ekran zorunludur. Mobil dokunma hedefi en az 48 dp; büyük yazı ve klavye açıkken alan/işlem görünür kalır.
- Kampüs/sınıf/kadro arşivinde bağlı kayıtlar güvenli aktarılır; geçmiş finans/not/yoklama korunur. Yetersiz kontenjan, branş ve program çakışmaları engellenir. Arşivden geri almak aktarılan görevleri otomatik geri taşımaz.

## Komutlar ve teslimler

`pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`, `pnpm mobile`, `pnpm build:apk`, `pnpm run deploy`.

Güncel Android teslim/kontrol bilgileri `docs/mobile-release.md`, sayfa rehberi `docs/sayfalar.md`, yatırımcı sunumu `sunumlar/` içindedir. Sunum üretim kaynakları `scripts/sunum/`; yeniden üretim adımları `sunumlar/OKU.md` dosyasındadır. Sunumda kullanılan kaynak ekran görüntüleri korunur. Geçici build/cache/rapor klasörleri, eski APK ve aynı sunumun yinelenen kopyaları teslim arşivi olarak tutulmaz. Ortam dosyaları, lockfile ve imzalama bilgileri temizliğe dahil edilmez.

## Yayın ve geri dönüş

1. `demo.onurevis.com` DNS kaydını ve `45.136.6.28` üzerindeki Nginx/SSH erişimini doğrula. Mevcut diğer siteleri koruyarak `/var/www/kampus-demo` altında ayrı sürüm dizinleri kullan.
2. Yerelde lint, format, birim/uçtan uca testler ve production build çalıştır. Yalnızca derlenmiş statik dosyaları sunucuya aktar; backend, veritabanı ve ortam sırrı ekleme.
3. Nginx SPA yönlendirmesi, video aralık istekleri, PDF worker MIME türü, önbellek kuralları ve `/healthz` kontrolü tanımla. Let's Encrypt sertifikası, HTTP → HTTPS yönlendirmesi ve otomatik sertifika yenilemesi uygula.
4. Sürüm geçişini atomik bağlantı değişimiyle yap; önceki sürüm ve Nginx yapılandırmasını sakla. Hatalı aktivasyonda geri dön. Mevcut sunucu izleme panelinin Nginx ve kaynak takibini doğrula.
5. Canlı ortamda beş rolü, doğrudan sayfa yenilemesini, video/PDF akışlarını, mobil görünümü ve TLS sertifikasını kontrol et. Yayın ve geri dönüş komutlarını README'de belgeleyerek işlemi scriptleştir.

## Tamamlanma ölçütü

Tüm belirtilen sayfalar gezilebilir; ilgili listeler arama/filtre ve sayfalama içerir; form değişiklikleri doğru rol/sınıf/öğrenciye yansır. Ödeme mükerrer yapılmaz, quiz puanı cevaplardan hesaplanır, yoklama yinelenmez. Lint, build ve test sonuçları README'de açıklanır.
