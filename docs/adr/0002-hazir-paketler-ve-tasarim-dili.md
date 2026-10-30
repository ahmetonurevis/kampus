# ADR 0002 · Hazır paket ilkesi ve Liquid Glass tasarım dili

- Durum: Kabul edildi (2026-10-30)
- Karar veren: Oğuzhan Demirci
- Değiştirdiği: ADR 0001 karar 6'nın kimlik tabloları ve karar 7 (kimlik doğrulama)

## Bağlam

Platform geçişinde (ADR 0001) web, API ve mobil sıfırdan kuruluyor. Kullanıcı yönergesi: arayüzde ve backend'de hazır, bakımı süren paketler kullanılacak; gerekmedikçe kendi kütüphanemiz yazılmayacak. Tasarım dili olarak Liquid Glass serbest bırakıldı. Eski tasarım kuralı cam efektini yasaklıyordu; bu karar onu ölçülü biçimde değiştirir.

## Kararlar

1. **Önce hazır paket.** Tablo, form, diyalog, menü, bildirim, tarih seçici, kimlik doğrulama, sorgu önbelleği, kuyruk gibi genel sorunlar için kod yazılmaz; aşağıdaki seçili paketler kullanılır. Listede olmayan bir paket eklemeden önce ölçüt: aktif bakım, TypeScript tipleri, MIT/Apache/BSD lisansı, erişilebilirlik (arayüzde), makul boyut. Kendi kodumuz yalnız alana özgü kural (school-core), paketleri bağlayan ince katman ve tasarım tokenlarıdır.

2. **Web (`apps/web-react`):**
   - Stil: Tailwind CSS v4 (`@tailwindcss/vite`); tokenlar tek CSS dosyasında `@theme` ile.
   - Bileşenler: shadcn/ui (Radix UI ilkelleri), `src/components/ui/` altına CLI ile alınır ve tokenlarla temalandırılır. Ek: `cmdk` (combobox), `vaul` gerekirse.
   - Tablo: `@tanstack/react-table`; uzun listede `@tanstack/react-virtual`.
   - Sunucu durumu: `@tanstack/react-query` (`packages/react-shared` üzerinden).
   - Form: `react-hook-form` + `@hookform/resolvers` (Zod).
   - Bildirim: `sonner`. İkon: `lucide-react`. Tarih: `date-fns` + `tr` yereli, seçici `react-day-picker`. Grafik: `recharts` (yalnız gerçek veriden).
   - Yönlendirme: `react-router` 7.

3. **API (`apps/api`):**
   - Fastify 5 + resmi eklentiler (`@fastify/helmet`, `cors`, `cookie`, `rate-limit`, `multipart`, `swagger` + `swagger-ui`).
   - Doğrulama: Zod 4 + `fastify-type-provider-zod`; OpenAPI belgesi şemalardan üretilir.
   - Veri: Drizzle ORM + drizzle-kit; testte PGlite.
   - **Kimlik doğrulama: Better Auth** (ADR 0001 karar 7'nin yerine). E-posta + parola (scrypt), veritabanı oturumları, yerleşik hız sınırı. `organization` eklentisi kurumdur: kullanıcı birden çok kuruma üye olabilir, etkin kurum oturumda tutulur. Roller (`yonetici`, `onburo`, `ogretmen`, `ogrenci`, `veli`) access control ile tanımlanır. Kurum türü (`school`/`language_school`), açık modüller ve üyeliğin school-core kayıt bağlantısı (öğrenci, veliye bağlı çocuklar, öğretmen) eklenti ek alanlarıyla ya da 1:1 bağlı tablolarla tutulur. Mobil `@better-auth/expo` ile oturumu güvenli depoda saklar. Elle JWT/yenileme belirteci yazılmaz. Kurum ve rol kapsamı yine sunucuda, oturumdaki etkin kurum + school-core kapsam kurallarıyla uygulanır.
   - Arka plan işleri (bülten, bildirim, toplu içe aktarma): `pg-boss`. E-posta: `nodemailer`. Nesne depolama: S3 uyumlu istemci (`@aws-sdk/client-s3`), yerelde disk.
   - Log: pino (Fastify yerleşik), gizli alanlar redakte.

4. **İstemci paketleri:** `packages/api-client`, Fastify'nin OpenAPI belgesinden `openapi-typescript` ile tip üretir ve `openapi-fetch` ile çağırır; oturum işlemleri Better Auth istemcisiyle (`better-auth/react`, mobilde `@better-auth/expo/client`) yapılır. Elle istemci kütüphanesi yazılmaz.

5. **Mobil:** React Navigation, TanStack Query, react-hook-form, `@better-auth/expo` + `expo-secure-store`. Cam yüzey iOS'ta `expo-glass-effect`, desteklenmeyen platformda (Android dahil) opak token zemini.

6. **Tasarım dili: ölçülü Liquid Glass.**
   - Cam malzeme yalnız içeriğin üstünde yüzen gezinme ve kontrol katmanındadır: sidebar, navbar, açılır menü, popover, modal ve sağ panel zemini, toast, mobil üst başlık. Tablo, form, belge, PDF ve uzun metin yüzeyleri opaktır.
   - Cam; yarı saydam token zemini + `backdrop-filter` (bulanıklık, doygunluk) + ince yarı saydam vurgu çizgisiyle yapılır. Köşeler eş merkezli, kontroller kapsül biçimine yakın. Değerler tokenlardan gelir; bileşende sabit değer yazılmaz.
   - Okunabilirlik önce gelir: metin ve ikon kontrastı WCAG AA. `prefers-reduced-transparency`, `prefers-contrast: more`, `backdrop-filter` desteği olmayan tarayıcı ve düşük güç durumunda yüzey opak token zeminine döner.
   - Marka korunur: ana renk `#1E3A8A`, aksan `#F97316`, web açık zemini `#FFFFFF`, mobil sayfa zemini `#EFF3FB`. Açık/koyu tema birlikte.
   - Yasaklar sürer: gradyan zemin, ışık hüzmesi, yoğun gölge, dekoratif renkli kenar, veriye dayanmayan grafik. Kırılma/distorsiyon efektleri (SVG filtreli "liquid" taklitleri) performans ve tarayıcı desteği nedeniyle kullanılmaz.

## Sonuçlar

- Elle yazılacak güvenlik kodu azalır (parola özeti, belirteç rotasyonu, hız sınırı Better Auth'ta). Karşılığında Better Auth sürüm güncellemeleri izlenir; şeması drizzle-kit migration'larına dahil edilir.
- Vue bileşenleri davranış referansı olmaya devam eder (liste durumu, odak, iç içe pencere, e2e erişilebilir adları); uygulama shadcn/Radix + TanStack ile yapılır.
- `CLAUDE.md` tasarım kuralı ve `.claude/rules/web.md` bu karara göre güncellenir.

## Değerlendirilen alternatifler

- **Mantine / MUI:** hazır ve kapsamlı, fakat cam katmanı ve token düzeniyle özelleştirmesi Tailwind + Radix kadar doğrudan değil; MUI ağır.
- **React Aria Components:** erişilebilirlikte çok güçlü; ekosistem ve hazır desen sayısı shadcn/Radix kadar geniş değil. Tarih/zaman gibi ihtiyaçta tek bileşen olarak eklenebilir.
- **Elle JWT + yenileme belirteci (ADR 0001 karar 7):** bağımlılıksız ama güvenlik açısından kritik kodu bizim yazmamızı gerektiriyor; reddedildi.
- **Auth.js, Lucia:** Auth.js çatı odaklı ve Better Auth ile birleşme sürecinde; Lucia kütüphane olarak bırakıldı.
- **Tam Liquid Glass (her yüzey cam, kırılma efekti):** okunabilirlik, erişilebilirlik ve düşük donanımlı okul cihazlarında performans riski; reddedildi.
