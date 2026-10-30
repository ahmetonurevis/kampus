---
paths:
  - 'apps/web/**'
  - 'apps/web-react/**'
  - 'packages/react-shared/**'
---

# Web kuralları

Ayrıntı: `docs/muhendislik/kod-yazim.md` §4, `docs/muhendislik/erisilebilirlik-performans.md`.

## React (`apps/web-react`, yeni geliştirme burada)

- React 19 fonksiyon bileşenleri + hook'lar, TypeScript strict. Sunucu verisi `packages/react-shared` hook'ları (`@kampus/api-client` üzerinden) ile okunur ve yazılır; bileşen içinde doğrudan `fetch` yazılmaz.
- Klasörler: `components/` (ortak), `pages/<alan>/` (rota bileşenleri, `GoalListPage.tsx`), `hooks/`, `lib/`, `styles/`. Bileşen dosyası PascalCase, diğerleri kebab-case.
- Türetilebilen değer state'te tutulmaz; `useEffect` yalnız dış sistemle eşitleme için. Liste anahtarı kalıcı kimlik. `memo`/`useMemo` ölçülmüş yavaşlıkta.
- Görsel dil Vue uygulamasıyla aynıdır: renk/ölçü tek token dosyasından (Vue'daki `apps/web/src/styles/tokens.css` ve `presentation.css` kaynak alınır). Sabit hex renk, gradyan, gölge, dekoratif renkli kenar eklenmez. Açık ve koyu tema birlikte kontrol edilir.
- Ortak bileşenler Vue karşılıklarının davranışını taşır: `DataTable`, `CollectionList`, `ListFilters`, `Pagination`, `Modal`, `PageHeading`, `Badge`, `LineTabs`, `FormSteps`, `PdfButton`/`PdfPreview`, `Icon` (lucide-react). Önce mevcut bileşen kullanılır.
- Ekran taşırken Vue görünümü davranış referansıdır; e2e senaryosu kabul testidir. Seçicilerin dayandığı erişilebilir ad ve etiketler korunur.
- Kullanıcı metni Türkçe; `ApiError.issues` alan mesajına, diğer hatalar toast'a, teknik ayrıntı loga. Her rota hata sınırı içinde; gönderim sürerken düğme kilitli.
- Erişilebilirlik (WCAG 2.2 AA): her kontrolün görünür etiketi, klavye odağı ve görünür odak halkası; odak sabit başlık/toast altında kalmaz; hedef en az 24×24 px; toast `role="status"`, hata `role="alert"`; İngilizce içerik `lang="en"`; sürükle-bırakın düğme karşılığı var; 320 px'te yeniden akış, 390 px'te yatay taşma yok.
- Performans: ilk JS ≤ 200 KB gzip, rota parçası ≤ 100 KB; rotalar `React.lazy`; pdfjs/jspdf yalnız belge açılınca `import()`. LCP ≤ 2,5 sn, INP ≤ 200 ms, CLS ≤ 0,1.
- Yenileme belirteci httpOnly çerezde, erişim belirteci yalnız bellekte; `localStorage`/`sessionStorage`'a belirteç veya kişisel veri yazılmaz. `dangerouslySetInnerHTML` yok.

## Vue (`apps/web`, yalnız referans)

- Yeni özellik eklenmez, TypeScript'e taşınmaz. Yalnız kırık testi veya CI'ı düzeltmek için değişir.
