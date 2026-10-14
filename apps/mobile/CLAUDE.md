# Kampüs Android

React Native ve Expo. Beş rol, mevcut modüller, çevrimdışı ortak örnek veri ve AsyncStorage kalıcılığı. Gerçek ödeme, uzaktan bildirim ve web–telefon senkronizasyonu yoktur.

- `src/ui`: ortak açık/koyu tema, 48 dp dokunma alanları, alan etiketleri, seçim/detay pencereleri.
- `src/model`: role göre görünür veri ve doğrulanan atomik işlemler; platform bağımsızdır.
- `src/screens`: dashboard, modül listeleri, ayrıntı/quiz/video/yoklama akışları.
- `src/store`: kayıt okuma/yazma, oturum/tema, Türkçe hata bildirimleri ve yerel yapılandırılmış log.
- `packages/school-core`: web ile aynı başlangıç verisi, finans/puanlama/CRUD kuralları ve belge kayıtları.

Safir `#1E3A8A` üst başlık ve vurgu yüzeyleri, turuncu `#F97316` aksan; sayfa zemini yumuşak mavi-gri `#EFF3FB`, kartlar beyaz (koyu temada lacivert tonlar). Renk geçişi ve renkli dekoratif kenar çizgisi yoktur. Android sistem geri tuşu, güvenli ekran alanları, yazı ölçeği ve klavye çakışmaları ele alınır. Hamburger menü yoktur: ana ekrandaki `ui/ModuleHub` kategorileri kart olarak gösterir (`model/hub.js`); karta dokununca `screens/CategoryScreen` o kategorinin modüllerini kart olarak açar. Hesap sayfaları (`ayarlar`, `HESABIM` grubu) kategori kartlarında tekrarlanmaz; sağ üstteki isim/avatar menüsünde yer alır. `availablePages` telefonda gösterilmeyen sayfaları (öğrenci `odemelerim`) eler; web menüsü değişmez. İç sayfalarda geri tuşu ve "Modüller" düğmesi ana ekrana döner. Hızlı erişim ve alt navigasyon eklenmez.

APK Expo Go veya geliştirme sunucusu gerektirmeden açılmalıdır. İmzalama anahtarı kaynak dışında saklanır. `pnpm build:apk` kalite kontrolleri ve yerel release derlemesi yapar. Üretilen APK'lar proje kökündeki `apklar/` klasöründe bulunur; bu klasör yalnızca APK içerir. Derlemede SHA-256 özetleri ve geçici kayıtlar `artifacts/mobile-build/` altında oluşturulur. Güncel teslim özeti `docs/mobile-release.md` içindedir.

## Güncel uygulama kararları

Yeni üç rol akışı `RoleHome`, `SchoolLists`, `SchoolDetails` ve `Attendance` ekranlarında; ortak düzen `ui/SchoolLayout` içindedir. Mevcut modül/iş kuralları korunur. Role göre stack grubu yenilenir; çocuk değişiminde stack korunur. Sistem tema tercihi `resolvedTheme` ile çözümlenir. Referans örnekler `model/experience` içinde mevcut veriyi bozmayan sabit kimliklerle eklenir; snapshot temeli orijinal `createSeed(createdAt)` olarak kalır.

Uygulama notları: Ana ekran bölümleri `Section` bileşeninin `panel` seçeneğiyle ayrılır; listeler `ListRow card` kullanır. Arama alanı sütun içinde esnemez, yatay kullanımda genişlik `style` ile verilir. Modal pencereler güvenli alan payını dış katmanda uygular. Büyük yazıda sekmeler yatay kayar ve seçim otomatik görünür alana alınır. Gezinme eski sayfanın geçici bildirimini temizler.

1.3.0 uygulama notları: `KeyboardLayout` tek kök KeyboardProvider, layout modunda KeyboardAwareScrollView ve otomatik konum ölçen KeyboardFrame sağlar; native Modal için ayrı sağlayıcı açılmaz. `use-persistent-draft` küçük taslakları ayrı AsyncStorage anahtarlarında, sıralı yazma/silme ile saklar. `Timetable`, `VideoLibrary`, `Conversations` ortak menü/rol kapsamı üzerinden açılır. Sohbet gönderme düğmesi alanın yanındadır; yazarken taslak açıklaması gizlenerek küçük ekran alanı korunur.

1.4.0 uygulama notları: Okul iş akışı modülleri (rehberlik, deneme, hedef planı, kayıt yenileme, program, çalışma planı, takvim, servis, yemek, kulüp) `WorkflowScreen` ile çalışır; liste/detay/form tanımları `school-core/lib/workflow-presentation.js` içindedir, form `ui/WorkflowFormSheet` ve alan çizici `ui/WorkflowFields` ile kontrol adımlı ve zod doğrulamalı sunulur. Optik değerlendirme ve otomatik etüt kendi ekranlarını kullanır; CSV/DAT/TXT dosyaları `lib/text-files.js` ile seçilir, UTF-8 ve Windows-1254 `school-core/lib/text-decoding.js` ile çözülür. `commit` isteğe bağlı `onError` alır; açık pencerede hata form içinde gösterilir.

## Performans ve kayıt bütünlüğü

- Kategori değişiminde ana ekran yeniden kurulmaz; kapalı menüler ve odakta olmayan ekranlar gereksiz çizilmez.
- Tarih/para biçimleyicileri yeniden kullanılır. Rol/sınıf/ders kapsamı tek geçişte hazırlanır; yazarken okul verisinin tamamı klonlanmaz.
- Taslaklar rol/çocuk/kayıt/sınıf/gün bazında ayrılır, başarılı işlemden sonra temizlenir; kalıcılık hatasında korunur ve Türkçe bildirim gösterilir.
- Android sistem geri tuşu, çevrimdışı yeniden açılış, güncellemede kayıtların korunması ve güvenli ekran alanları kontrol edilir.

## Doğrulama ve teslim

İş öncesi kapsam ve etkilenen dosyalar planlanır. Lint, format, kritik iş kuralı testleri ve web build çalıştırılır. Native değişikliklerde Android release derlemesi, güncelleme kurulumu, beş rol, açık/koyu tema, 320 dp/büyük yazı ve klavye/form akışları kontrol edilir. Fiziksel cihaz yoksa emülatör sınırı açıkça raporlanır.

Güncel sürüm 1.4.0 (kod 7), teslim `apklar/kampus-1.4.0.apk`. Üretim ve kontrol kapsamı kökteki `docs/mobile-release.md` dosyasındadır. Mobil çalışmaları canlı web yayınını kendiliğinden değiştirmez.
