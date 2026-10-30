---
paths:
  - 'apps/web/**'
  - 'apps/web-react/**'
  - 'packages/react-shared/**'
---

# Web kuralları

## React (`apps/web-react`, yeni geliştirme burada)

- React 19 fonksiyon bileşenleri + hook'lar, TypeScript strict. Sunucu verisi `packages/react-shared` hook'ları (`@kampus/api-client` üzerinden) ile okunur ve yazılır; bileşen içinde doğrudan `fetch` yazılmaz.
- Görsel dil Vue uygulamasıyla aynıdır: renk/ölçü tek token dosyasından (Vue'daki `apps/web/src/styles/tokens.css` ve `presentation.css` kaynak alınır). Sabit hex renk, gradyan, gölge, dekoratif renkli kenar eklenmez. Açık ve koyu tema birlikte kontrol edilir.
- Ortak bileşenler Vue karşılıklarının davranışını taşır: `DataTable`, `CollectionList`, `ListFilters`, `Pagination`, `Modal`, `PageHeading`, `Badge`, `LineTabs`, `FormSteps`, `PdfButton`/`PdfPreview`, `Icon` (lucide-react). Önce mevcut bileşen kullanılır.
- Ekran taşırken Vue görünümü davranış referansıdır; e2e senaryosu kabul testidir. Seçicilerin dayandığı erişilebilir ad ve etiketler korunur.
- Kullanıcı metni Türkçe; hatalar toast ve alan mesajıyla, teknik ayrıntı loga.
- Erişilebilirlik: her kontrolün etiketi, klavye odağı ve görünür odak halkası; 390 px genişlikte yatay taşma yok.

## Vue (`apps/web`, yalnız referans)

- Yeni özellik eklenmez, TypeScript'e taşınmaz. Yalnız kırık testi veya CI'ı düzeltmek için değişir.
