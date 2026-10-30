---
paths:
  - 'apps/web/**'
  - 'apps/web-react/**'
  - 'packages/react-shared/**'
---

# Web kuralları

## React (`apps/web-react`, yeni geliştirme burada)

- React 19 fonksiyon bileşenleri + hook'lar, TypeScript strict. Sunucu verisi `packages/react-shared` hook'ları (`@kampus/api-client` üzerinden) ile okunur ve yazılır; bileşen içinde doğrudan `fetch` yazılmaz.
- Hazır paket önce (ADR 0002): Tailwind CSS v4, shadcn/ui (Radix) bileşenleri `src/components/ui/` altında, `@tanstack/react-table` (+ `react-virtual`), `react-hook-form` + Zod resolver, `sonner`, `lucide-react`, `date-fns` (`tr`), `react-day-picker`, `recharts`. Diyalog, menü, tablo, form, bildirim gibi şeyler elle yazılmaz.
- Görsel dil ölçülü Liquid Glass'tır (ADR 0002 karar 6). Renk/ölçü/cam değerleri tek token dosyasından (`@theme`) gelir; marka değerleri Vue'daki `apps/web/src/styles/tokens.css`'ten alınır. Cam yalnız yüzen katmanda (sidebar, navbar, menü, popover, modal/panel zemini, toast); içerik yüzeyleri opak. `prefers-reduced-transparency`, `prefers-contrast: more` ve `backdrop-filter` desteksizliğinde opak yedek. Bileşende sabit hex, gradyan, yoğun gölge, dekoratif renkli kenar yok. Açık ve koyu tema birlikte kontrol edilir.
- Ortak bileşenler Vue karşılıklarının davranışını taşır: `DataTable`, `CollectionList`, `ListFilters`, `Pagination`, `Modal`, `PageHeading`, `Badge`, `LineTabs`, `FormSteps`, `PdfButton`/`PdfPreview`, `Icon`. Uygulamaları hazır paketlerin üzerine ince katmandır; önce mevcut bileşen kullanılır.
- Ekran taşırken Vue görünümü davranış referansıdır; e2e senaryosu kabul testidir. Seçicilerin dayandığı erişilebilir ad ve etiketler korunur.
- Kullanıcı metni Türkçe; hatalar toast ve alan mesajıyla, teknik ayrıntı loga.
- Erişilebilirlik: her kontrolün etiketi, klavye odağı ve görünür odak halkası; 390 px genişlikte yatay taşma yok.

## Vue (`apps/web`, yalnız referans)

- Yeni özellik eklenmez, TypeScript'e taşınmaz. Yalnız kırık testi veya CI'ı düzeltmek için değişir.
