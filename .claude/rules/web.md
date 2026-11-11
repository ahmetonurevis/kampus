---
paths:
  - 'apps/web/**'
  - 'apps/web-react/**'
  - 'packages/react-shared/**'
---

# Web kuralları

Ayrıntı: `docs/muhendislik/kod-yazim.md` §4, `docs/muhendislik/erisilebilirlik-performans.md`, ADR 0002.

## React (`apps/web-react`, yeni geliştirme burada)

- React 19 fonksiyon bileşenleri + hook'lar, TypeScript strict. Sunucu verisi `packages/react-shared` hook'ları (`@kampus/api-client` üzerinden) ile okunur ve yazılır; bileşen içinde doğrudan `fetch` yazılmaz.
- Hazır paket önce (ADR 0002): Tailwind CSS v4, shadcn/ui (Radix) bileşenleri `src/components/ui/` altında, `@tanstack/react-table` (+ `react-virtual`), `react-hook-form` + Zod resolver, `sonner`, `lucide-react`, `date-fns` (`tr`), `react-day-picker`, `recharts`, `react-router` 7. Diyalog, menü, tablo, form, bildirim gibi şeyler elle yazılmaz. Listede olmayan paket için ölçütler `docs/muhendislik/kod-yazim.md` §8.
- Klasörler: `components/ui/` (shadcn CLI çıktısı; yalnız token ve erişilebilirlik için düzenlenir), `components/` (paketler üzerine ince katman), `pages/<alan>/` (rota bileşenleri), `hooks/`, `lib/`, `styles/`. Bileşen dosyası PascalCase, diğerleri kebab-case.
- Görsel dil (ölçülü Liquid Glass, token, cam yalnız yüzen katmanda, opak yedek, sabit hex/gradyan yok, açık/koyu tema) `tasarim.md`'dedir; burada tekrarlanmaz.
- Ortak bileşenler Vue karşılıklarının davranışını taşır: `DataTable`, `CollectionList`, `ListFilters`, `Pagination`, `Modal`, `PageHeading`, `Badge`, `LineTabs`, `FormSteps`, `PdfButton`/`PdfPreview`, `Icon`. Uygulamaları hazır paketlerin üzerine ince katmandır; önce mevcut bileşen kullanılır.
- API'li liste ekranı `docs/muhendislik/kod-yazim.md` "API'li liste ekranı kalıbı" adımlarıyla kurulur (`ServerDataTable`, `use-core-collection`, `use-detail-panel`, `use-csv-export`, `QueryError`, `page-registry`). Yazma komutu `useApiCommand` ile ("API'li yazma kalıbı": istek anahtarı, kilit, tazeleme, toast/`setError`).
- Ekran taşırken Vue görünümü davranış referansıdır; e2e senaryosu kabul testidir. Seçicilerin dayandığı erişilebilir ad ve etiketler korunur.
- Türetilebilen değer state'te tutulmaz; `useEffect` yalnız dış sistemle eşitleme için. Sorgu anahtarı etkin kurumu içerir; kurum değişince sorgu önbelleği temizlenir.
- Kullanıcı metni Türkçe; hatalar toast (`sonner`) ve alan mesajıyla (`ApiError.issues` → `setError`), teknik ayrıntı loga. Her rota hata sınırı içinde; gönderim sürerken düğme kilitli.
- Erişilebilirlik (WCAG 2.2 AA): her kontrolün etiketi, klavye odağı ve görünür odak halkası; odak sabit katman altında kalmaz; hedef en az 24×24 px; cam üstündeki metin en kötü zeminde AA kontrastta; İngilizce içerik `lang="en"`; sürükle-bırakın düğme karşılığı var; 320 px'te yeniden akış, 390 px genişlikte yatay taşma yok.
- Performans: ilk JS ≤ 200 KB gzip, rota parçası ≤ 100 KB; rotalar `lazy`; pdfjs/jspdf/recharts yalnız gerektiğinde `import()`. LCP ≤ 2,5 sn, INP ≤ 200 ms, CLS ≤ 0,1. Aynı anda en fazla 3 bulanık katman.
- Oturum Better Auth istemcisiyle (`better-auth/react`); belirteç veya kişisel veri `localStorage`/`sessionStorage`'a yazılmaz. `dangerouslySetInnerHTML` yok.

## Vue (`apps/web`, yalnız referans)

- Yeni özellik eklenmez, TypeScript'e taşınmaz. Yalnız kırık testi veya CI'ı düzeltmek için değişir.
