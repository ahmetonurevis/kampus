---
paths:
  - 'apps/web-react/**'
  - 'apps/web/**'
  - 'apps/mobile/**'
  - 'packages/react-shared/**'
  - 'packages/school-core/src/lib/document-data.ts'
---

# Tasarım ve davranış kuralları

Web, mobil ve PDF şablonlarına dokunulduğunda yüklenir. PDF şablonları `apps/web-react/src/lib/pdf/`, web tokenları `apps/web-react/src/styles/tokens.css`, mobil tema `apps/mobile/src/ui/theme.ts`. Karar: ADR 0002. Web uygulama kuralları `web.md`, mobil kurallar `apps/mobile/CLAUDE.md`.

- Ana renk `#1E3A8A`, aksan `#F97316`, web açık zemini `#FFFFFF`; mobilde sayfa zemini yumuşak mavi-gri `#EFF3FB`, kartlar beyaz, üst başlık safirdir. Açık/koyu tema birlikte bulunur; varsayılan açık, mobilde sistem seçeneği de vardır. Tema tercihi saklanır.
- Tasarım dili ölçülü Liquid Glass'tır (ADR 0002). Cam yalnız içeriğin üstünde yüzen gezinme/kontrol katmanında kullanılır: sidebar, navbar, menü, popover, modal/sağ panel zemini, toast ve mobil üst başlık. Tablo, form, belge ve metin yüzeyleri opaktır. Kontrast WCAG AA'dır; azaltılmış saydamlık, yüksek kontrast ve desteksiz ortamda yüzey opak zemine döner. Gradyan zemin, ışık hüzmesi, yoğun gölge, dekoratif renkli kenar, kırılma efekti ve veriye dayanmayan grafik kullanılmaz. İnce ayraçlar, düzenli boşluklar, eş merkezli yuvarlak köşeler ve okunaklı metin esastır.
- Web görsel dil uygulaması (ADR 0002 karar 6): renk/ölçü/cam değerleri tek token dosyasından (`@theme`) gelir; marka değerleri Vue'daki `apps/web/src/styles/tokens.css`'ten alınır. `prefers-reduced-transparency`, `prefers-contrast: more` ve `backdrop-filter` desteksizliğinde opak yedek. Bileşende sabit hex, gradyan, yoğun gölge, dekoratif renkli kenar yok. Açık ve koyu tema birlikte kontrol edilir.
- Hızlı erişim bölümü, navbar hızlı araması ve mobil alt navigasyon yoktur. Beş rolde kategorili menü kullanılır; kapalı modüller ve boş kategoriler gizlenir. Mobilde hamburger menü yoktur: ana ekranda kategoriler kart olarak gelir, karta dokununca kategori ekranı modülleri kart olarak listeler. Hesap sayfaları sağ üstteki isim/avatar menüsündedir; öğrenci ödemeleri telefonda gösterilmez.
- Web sidebar/navbar iç boşluklu yüzeylerdir; aktif bağlantı kısa pill, breadcrumb ve kontroller ayrıdır. Tema ve ölçüler tek token dosyasından gelir. Sidebar bağlantıları 11 px, grup etiketleri 10 px.
- Ana işlem görünür, ikincil işlemler sakin tutulur. Dashboard içerikleri 2:1; mini grafikler yalnızca gerçek kayıtlardan türetilir. Avatar rengi normalleştirilmiş tam ada göre sabittir.
- Masaüstü tablolarda sabit başlık/işlem sütunu, mobilde temel bilgiler ve açılan ayrıntılar kullanılır. Arama/filtre/sıralama/sayfa ve kaydırma konumu liste/çocuk bazında korunur. Filtre değişince sayfa ve konum sıfırlanır; veri azalınca geçersiz sayfada kalınmaz. CSV tüm filtrelenmiş/sıralanmış sonuçları içerir.
- Öğrenci/ödeme/sınıf özetleri ve kısa formlar sağ panel; uzun kayıt/sınıf formları ve PDF geniş alanda açılır. Liste bağlamı, URL geri/ileri, klavye odağı ve iç içe pencereler korunur.
- Dekont, sözleşme, taksit taahhütnamesi, materyal, ödev ve değerlendirme PDF'leri belge türüne özel şablon kullanır. Türkçe font, çok sayfalı içerik, tekrarlanan tablo başlığı, belge/sayfa numarası ve safir/turuncu marka düzeni korunur. PDF önizlemesi belge açıldığında yüklenir; indirme/yazdırma aynı PDF'yi kullanır; geçici URL'ler kapanışta temizlenir.
- Girişin 3B hareketi ve okunaklı KAMPÜS yazısı korunur; azaltılmış hareket/görünmeyen sekme desteklenir.
- Erişilebilir etiket, klavye odağı, azaltılmış hareket, dar/yatay ekran zorunludur. Mobil dokunma hedefi en az 48 dp; büyük yazı ve klavye açıkken alan/işlem görünür kalır.
