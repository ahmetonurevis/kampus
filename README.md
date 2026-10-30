# Kampüs · Akademi Özel Okulları

Ortaokul ve lise için Vue 3 web paneli ve React Native Android uygulamasıyla hazırlanmış Türkçe LMS + ERP demosu. Yönetici, ön büro, öğretmen, öğrenci ve veli aynı ilişkili veri kümesini paylaşır. Web tarafında 101 panel sayfası, açık/koyu tema ve mobil görünüm bulunur. Backend veya hesap kurulumu gerekmez.

## Yeni okul iş akışları

Rehberlik/takip dosyası, LGS/YKS/okul denemeleri ve CSV sonuç aktarımı, kayıt yenileme/dönem geçişi, çakışma kontrollü program yönetimi, çalışma planı/onay/değerlendirme, okul takvimi/veli izinleri, servis güzergâhları, yemek/alerjen menüsü ve kulüp/yoklama/proje akışları web paneline eklendi. Sekiz özellik servis/yemek ayrımıyla dokuz bağımsız modüldür. Yönetici ayarlarından ayrı ayrı kapatılabilir.

Yeni akışlar ortak school-core 2.4.0 paketini kullanır. Eski yerel kayıtlar ve modül tercihleri korunur. Yenileme sözleşmesi yalnızca yeni dönem taksitlerini içerir; sınıf geçişi ayrı onayla uygulanır. Kullanım ve CSV şablonu: [Okul iş akışları](docs/okul-is-akislari.md).

## Optik değerlendirme ve otomatik etüt

CSV ve alan konumları ayarlanabilen DAT/TXT cevap dosyaları, kitapçık bazlı anahtarlarla soru/kazanım düzeyinde değerlendirilir. Başarı eşiği altında kalan kazanımlar için kapasite ve çakışma kontrollü etüt planı hazırlanır; önizleme ve son onaydan sonra öğrenci/veli programına yansır. Yoklama ve iptal geçmişi korunur. İki özellik ayrı modüllerdir; toplam on iki web iş akışı modülü bulunur. Kullanım ve dosya biçimleri: [Optik değerlendirme ve etüt](docs/optik-degerlendirme-etut.md).

## Hedef ve gelişim planı

Öğrenci ders bazlı veya genel net hedefi belirler; yönetici ya da branş öğretmeni onaylar. İlerleme deneme sonuçlarından otomatik hesaplanır, zayıf konulardan haftalık gelişim adımları önerilir ve elle düzenlenir. Veli seçili çocuğun hedefini görür, yorum ekler. Modül ayrı açılıp kapanır. Kullanım: [Hedef ve gelişim planı](docs/hedef-gelisim-plani.md).

## Android uygulaması

Doğrudan kurulabilir imzalı APK: [kampus-1.4.0.apk](apklar/kampus-1.4.0.apk). Güncel teslim, yalnızca APK içeren `apklar/` klasöründedir. Beş rol, çevrimdışı kalıcı veri, iki yerel video, PDF kaydetme/paylaşma ve dosya teslimi desteklenir. Native kaynaklar `apps/mobile`, web ile paylaşılan iş kuralları `packages/school-core` içindedir. Web ve telefon kayıtları birbirinden bağımsızdır; okul iş akışı modüllerinin tamamı (optik değerlendirme, otomatik etüt ve hedef/gelişim planı dahil) telefonda da bulunur. Ana ekranda hamburger menü yerine kategori kartları yer alır; kategoriye dokununca modülleri kart olarak açılır. Hesap ayarları sağ üstteki isim menüsündedir.

`pnpm mobile` geliştirme sunucusunu, `pnpm build:apk` kalite kontrollerini ve yerel Android release derlemesini çalıştırır. Kurulum, desteklenen cihazlar, imzalama ve doğrulama ayrıntıları: [Android teslim notları](docs/mobile-release.md).

## Çalıştırma

Node.js 24 ve pnpm 11.21.0 kullanın. Sürümler `.nvmrc`, `package.json` ve `pnpm-lock.yaml` ile sabitlenir.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

**http://127.0.0.1:5173** adresini açın. Giriş ekranından veya üst bardan rol seçin.

Yeni React web uygulaması (`apps/web-react`, geçiş sürüyor) `pnpm dev:react` ile **http://127.0.0.1:5174** adresinde açılır ve gerçek API'ye bağlıdır: önce veritabanı ve API (`docker compose up -d`, `pnpm --filter @kampus/api db:migrate`, `pnpm --filter @kampus/api db:seed`, `pnpm dev:api`; `.env` için `apps/api/.env.example`). Vite `/api` isteklerini API'ye vekiller (varsayılan `http://127.0.0.1:3000`, `KAMPUS_API_URL` ile değişir); oturum aynı kökende Better Auth çerezindedir, sayfa yenilense de korunur. Demo hesapları ve parolası `db:seed` çıktısındadır (Akademi: `murat.yilmaz`, `busra.aydin`, `selin.kaya`, `deniz.yilmaz`, `ayse.yilmaz` `@kampus.example`; Murat Yılmaz iki kurumun yöneticisidir, kurum avatar menüsünden değişir).

```bash
pnpm build                 # apps/web/dist ve apps/web-react/dist
pnpm preview               # http://127.0.0.1:4173
pnpm lint
pnpm typecheck             # TypeScript paketleri, kök birim testleri (tests/tsconfig.json) ve e2e-react tip denetimi
pnpm format:check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:react        # React web + API (PostgreSQL 16 gerekir: docker compose up -d)
```

Vue demosu için zorunlu ortam değişkeni yoktur. Statik barındırmada tüm uygulama yolları `index.html` dosyasına yönlendirilmelidir. Canlı demo `https://demo.onurevis.com` adresindedir. CI dosyası PR'larda format, lint, tip denetimi, unit test, API ve istemci paketi testleri, OpenAPI belgesi ile üretilen istemci tipleri denetimi, build ve tarayıcı testlerini çalıştırır; ayrı `e2e-react` işi PostgreSQL 16 ile React web + API uçtan uca testlerini koşar.

## API (`apps/api`)

Platform geçişinin ([ADR 0001](docs/adr/0001-platform-mimarisi.md), [ADR 0002](docs/adr/0002-hazir-paketler-ve-tasarim-dili.md)) sunucusu: Fastify 5 + TypeScript, PostgreSQL 16, Drizzle, kimlik için Better Auth. Vue demosu API'yi kullanmaz; React web ve mobil API'ye bağlanınca kullanacak.

```bash
docker compose up -d                       # PostgreSQL 16, 127.0.0.1:5433
cp apps/api/.env.example apps/api/.env     # BETTER_AUTH_SECRET'ı değiştirin
pnpm --filter @kampus/api db:migrate
pnpm --filter @kampus/api db:seed          # idempotent demo kurumları, kullanıcıları ve kayıtları
pnpm dev:api                               # http://127.0.0.1:3000
docker compose down
```

| Uç                                        | Erişim                                     |
| ----------------------------------------- | ------------------------------------------ |
| `GET /api/v1/health`                      | Açık; veritabanı yanıt vermezse 503        |
| `/api/v1/auth/*`                          | Better Auth (giriş, çıkış, kurum değişimi) |
| `GET /api/v1/me`                          | Oturum; kullanıcı, etkin kurum, üyelikler  |
| `GET /api/v1/memberships`                 | Yönetici, ön büro; sayfalı üye listesi     |
| `GET /api/v1/collections/:collection`     | Rol kapsamlı koleksiyon listesi (aşağıda)  |
| `GET /api/v1/collections/:collection/:id` | Rol kapsamlı tekil kayıt                   |
| `GET /api/v1/openapi.json`, `/api/docs`   | Yalnız üretim dışında                      |

- Kurum kimliği yalnız oturumun etkin kurumundan gelir; her istekte üyelik doğrulanır. Başarı `{ data, meta? }`, hata `{ code, message, issues?, requestId }`.
- Koleksiyon uçları geçiş köprüsüdür: ad school-core State anahtarıdır (`students`, `studentGoals`), arama `q`, eşitlik filtreleri, `sort`, `archived`, `page`/`pageSize` (≤ 100). Rol, kayıt ve alan kapsamı school-core `scopeFor`'dandır (`apps/api/src/services/read-scope.ts`; oturumdaki rol ve üyelik bağlantıları): öğretmen kendi sınıfları/branşını, öğrenci kendini, veli bağlı çocuklarını görür; rehberlik iç notunu yalnız rehberlik görevli öğretmen görür; ön büro akademik veriyi görmez. Arama ve filtre ayıklanmış alanlarda çalışır; kapsam dışı kayıt 404. Kapalı modülün koleksiyonu 403 `module_disabled`, kurum türünde olmayan modülünki 404.
- Demo kullanıcıları (`@kampus.example`, parola `.env`'deki `DEMO_PASSWORD`, boşsa `Demo-Giris-2026!`; üretimde varsayılan parola yok): Akademi Özel Okulları'nda `murat.yilmaz` (yönetici, iki kurumda), `busra.aydin`, `selin.kaya`, `deniz.yilmaz`, `ayse.yilmaz`; Kampüs Dil Akademisi'nde `gizem.tunc`, `ozan.er`, `lale.sezer`, `hakan.sezer`.
- Diğer komutlar: `test` (PGlite, Docker gerektirmez), `test:pg` (PostgreSQL 16 eşzamanlılık takımı; `TEST_PG_URL` atılabilir bir veritabanını gösterir, verilmezse atlanır — bkz. `docs/muhendislik/test-stratejisi.md` §4), `typecheck`, `openapi` / `openapi:check` (`apps/api/openapi.json`), `db:generate` (drizzle-kit migration), `auth:schema` (Better Auth şeması).

## İstemci paketleri (`packages/api-client`, `packages/react-shared`)

React web ve mobilin API'ye bağlanacağı ortak katman; henüz hiçbir uygulamaya bağlı değildir.

- **`@kampus/api-client`** (çatıdan bağımsız): `src/schema.d.ts` `apps/api/openapi.json`'dan `openapi-typescript` ile üretilir, elle düzenlenmez (`pnpm --filter @kampus/api-client generate`; güncellik `generate:check`, CI'da çalışır). `createKampusClient({ baseUrl, credentials, fetch?, clientVersion?, getHeaders? })` bir `openapi-fetch` istemcisi döndürür (`client.GET('/api/v1/me')`; uç başına elle fonksiyon yok). Sunucu hata zarfı ve ağ hatası `ApiError` (`status`, `code`, `message`, `issues`, `requestId`) olarak fırlatılır; `applyApiErrorToForm` doğrulama maddelerini react-hook-form `setError`'a aktarır. CSRF için özel başlık yoktur: API tarayıcının gönderdiği `Origin`/`Sec-Fetch-Site`'ı denetler. `auth.ts` Better Auth istemcisinin ortak seçeneklerini (`basePath` `/api/v1/auth`, organization eklentisi) verir; `createAuthClient` web (`better-auth/react`) ve mobilde (`@better-auth/expo/client` eklentisiyle) tüketicide kurulur. `baseUrl` API kökü, `/api/v1` öneki olmadan.
- **`@kampus/react-shared`** (React 19; DOM ve React Native'e bağlı değil): `KampusProvider` (API ve Better Auth istemcisi + TanStack Query), `createKampusQueryClient` (4xx'te yeniden deneme yok, 401'de `onUnauthenticated`), `institutionKey`/`sessionKey` (sorgu anahtarı etkin kurumla başlar), `useSession`, `useActiveInstitution` (`/me`, `switchInstitution`), `useApiQuery`, `useApiMutation` (`fieldIssues`/`applyToForm`). Kurum değişince kuruma bağlı sorgular, oturum kapanınca tüm önbellek silinir.
- Komutlar: `pnpm --filter @kampus/api-client test|typecheck|generate|generate:check`, `pnpm --filter @kampus/react-shared test|typecheck`.

## Özel okul yapısı

- **3 kampüs, 24 sınıf, 240 öğrenci, 48 branş öğretmeni, 30 aday.** Her kampüste 5–12. sınıflar bulunur; sınıf danışmanlığı ile ders öğretmenliği ayrı ilişkilerdir.
- **16 ders:** Matematik, Türkçe, Fen Bilimleri, Sosyal Bilgiler, Türk Dili ve Edebiyatı, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, İngilizce, Bilişim Teknolojileri, Müzik, Görsel Sanatlar, Beden Eğitimi, Din Kültürü ve Ahlak Bilgisi.
- Öğrenci başına dört aylık ders notları, 32 yoklama ve 8 taksit. Toplam 11.760 not ve 1.920 ödeme kaydı.
- 153 açıklamalı soru, sınıf/branşa göre 156 test ve 720 geçmiş sınav sonucu.
- 277 ödev, 1.851 teslim, ders ve sınıf düzeyi filtreli 92 çalışma dokümanı.
- 36 öğrenci sorusu; yanıtlar, yaklaşan ve aşılmış SLA süreleri. 16 okul duyurusu; dört konuşmada 8'er mesaj.
- İki gerçek, yerel MP4 ders videosu: **Denklemleri adım adım çözelim** ve **Hücreyi keşfedelim: bitki ve hayvan**. Türkçe ses, altyazı, ders notları, ileri/geri sarma ve kaldığı yerden devam etme.

Tarihler ilk açılış gününe göre üretilir. **Yönetici → Ayarlar → Demoyu sıfırla** tüm değişiklikleri sıfırlayıp tarihleri günceller. Yeni özel okul demosu ayrı depolama anahtarı (`kampus-private-school-v1`) kullanır; eski dil okulu verisi yüklenmez. Başlangıç verisi deterministik olarak üretilir; yalnızca değişiklikler localStorage'a yazılır. Açık sekmeler senkronize edilir.

## Yönetici işlemleri

**Kampüsler & Sınıflar:** kampüs ekleme, ad/adres düzenleme, sınıf açma, kontenjan ve derslik düzenleme, danışman ve her ders için branş öğretmeni atama. Sınıflar öğretmenin panelinde görünür.

**Eğitim Kadrosu:** öğretmen ekleme; ad, e-posta, telefon, branş ve kampüs düzenleme; branş/kampüs filtreleme.

**Arşivleme:** kayıtlar fiziksel silinmez. Kampüs kapatılırken sınıflar ve kadro başka kampüse, sınıf kapatılırken öğrenciler aynı düzeyde ve yeterli kontenjanı olan sınıfa, öğretmen ayrılırken aktif görevleri aynı branştaki uygun öğretmene aktarılır. Geçmiş notlar, yoklamalar ve finans kayıtları korunur. Çakışan program, yetersiz kontenjan ve uyumsuz branş Türkçe hata bildirimiyle engellenir. Arşivden geri alınabilir; geri alma, daha önce aktarılmış görevleri otomatik geri taşımaz.

## Demo rolleri ve örnek gezinti

| Rol      | Kişi                       | Giriş yolu            |
| -------- | -------------------------- | --------------------- |
| Yönetici | Murat Yılmaz               | `/yonetici/dashboard` |
| Ön Büro  | Büşra Aydın                | `/onburo/dashboard`   |
| Öğretmen | Selin Kaya · Matematik     | `/ogretmen/dashboard` |
| Öğrenci  | Deniz Yılmaz · 7-A         | `/ogrenci/dashboard`  |
| Veli     | Ayşe Yılmaz · Deniz ve Ece | `/veli/dashboard`     |

Deniz 7-A, Ece 5-A sınıfındadır. Öğrenci ve veli ders/branş seçerek ilgili öğretmene soru, mesaj ve randevu iletebilir. Öğretmen demo oturumu Selin Kaya'dır; fen öğretmeni Derya Arslan gibi diğer branşların kayıtları da veri kümesinde ayrı tutulur.

1. Yönetici olarak kampüs, öğretmen ve sınıf oluşturun. Sınıfın tüm derslerine branş öğretmeni atayın; öğretmen rolünde yeni sınıfı görün.
2. Ön bürodan aday ekleyin, görüşme notu yazın, tanışma randevusu planlayın ve kesin kayda dönüştürün. Sözleşme PDF'si ve taksit planı oluşur.
3. Öğretmenden yoklama kaydedin, 7-A'ya ödev atayın. Öğrenciden dosya teslim edin; öğretmenden puan ve geri bildirim verin. Veli ekranında sonucu görün.
4. Öğrenciden ders seçip soru sorun. Matematik sorusunu öğretmen demo oturumundan yanıtlayın. Test çözün; sonuç ders analizine işlensin.
5. İki sesli ders videosunu izleyin. Sayfayı yenilediğinizde aynı noktadan devam edin. Farklı derslerin çalışma PDF'lerini indirin.
6. Veliden çocuk seçin, ödeme planını inceleyin. Demo banka yanıtını başarı/red seçerek ödeme akışını deneyin; başarılı tahsilat ön büroya yansır ve PDF dekont oluşur.
7. Veli/öğrenciden branş öğretmeni seçip mesaj ve etüt talebi oluşturun. Ön bürodan veli talebini yönlendirin. Yönetici ayarlarından modülü kapatıp menü ve doğrudan URL erişiminin kapandığını görün.

Tam sayfa listesi: [docs/sayfalar.md](docs/sayfalar.md).

## Belge tasarımları, filtreler ve sayfalama

PDF indirmeleri belge türüne göre ayrı hazırlanır:

- **Dekont:** tahsil edilen tutar, işlem referansı, tarih/saat, yöntem, veli/öğrenci, alıcı kurum ve işlem açıklaması.
- **Sözleşme:** taraflar, eğitim kapsamı, bedel ve imza alanları; ayrı sayfada taksit planı eki.
- **Taksit taahhütnamesi:** toplam bedel, tahsil edilen, kalan bakiye, taksit tablosu ve onay alanları.
- **Ders materyali ve ödev:** ders/öğretmen bilgileri, konu anlatımı veya görev yönergesi, yazılabilir çözüm alanları. Ödev kartlarında “Çalışma kâğıdını görüntüle” bulunur.
- **Ödev değerlendirmesi:** teslim bilgileri, dosya adı, puan ve öğretmen geri bildirimi. Gerçek yüklenen dosyanın içeriği olarak sunulmaz.

Türkçe fontlar yereldir. Uzun metinler sayfalanır; her sayfada belge numarası ve sayfa numarası, devam tablolarında sütun başlıkları bulunur. Altı belge türü indirmeden önce ortak önizleme penceresinde açılır. Sayfa geçişi, yakınlaştırma, PDF indirme, yazdırma ve yeni sekmede açma desteklenir. Oluşturma hatasında yeniden denenebilir; kapanan pencerenin geçici URL ve görüntüleme kaynakları temizlenir. İç içe pencerelerde klavye odağı önceki pencereye döner.

PDF.js, gerçek PDF sayfalarını uygulamanın içinde gösterir; önizleme tarayıcının yerleşik PDF eklentisine bağlı değildir. Yazdırma penceresi de aynı PDF'nin tüm sayfalarından hazırlanır. PDF görüntüleyici ve yerel worker yalnızca belge açıldığında yüklenir.

Tablolarda ve uzun içerik listelerinde numaralı sayfalar, kayıt aralığı ve sayfa boyutu seçimi bulunur. Arama, filtre, sıralama veya sayfa boyutu değişince ilk sayfaya dönülür; sonuçlar azaldığında geçersiz sayfada kalınmaz. Filtre paneli açılıp kapanabilir; seçilen filtreler tek tek veya birlikte temizlenir.

Finansta kampüs/sınıf/yöntem/vade/tahsilat tarihi/tutar; CRM'de program/kampüs/kaynak/kayıt ve görüşme tarihi; okul yönetiminde danışman/sınıf düzeyi/doluluk/performans; akademik kayıtlarda konu/puan/tarih/devamsızlık; iletişimde kategori/birim/durum ve tarih filtreleri bulunur. Ödev, materyal, quiz, soru ve duyuru listelerinde içerikle ilgili filtreler ve sayfalama kullanılır. **CSV dışa aktarma tüm sayfalardaki filtrelenmiş ve sıralanmış sonuçları içerir.**

## Liste, form ve menü kullanımı

- Öğrenci adından akademik özet, taksit numarasından ödeme detayı, sınıf adından sınıf özeti sağ panelde açılır. Liste filtresi/sayfası/konumu korunur. Detay URL parametresinde taşınır; geri/ileri ve yenileme çalışır. Kısa düzenleme ve tahsilat formları sağ paneldedir; uzun sınıf/kayıt formları ve PDF önizlemesi geniş kalır. İç içe pencereler kapanırken odak önceki kontrole döner.
- Sekmeler ortak alt çizgili seçim bileşenini kullanır; sağ/sol ok, Home/End ve azaltılmış hareket desteklenir. Mobil sayfalamada kayıt aralığı, sayfa boyutu ve önceki/sonraki okları; masaüstünde ayrıca sayfa numaraları görünür. Mobil alt navigasyon eklenmemiştir.
- Masaüstü tablolarda başlık kaydırma alanının üstünde, işlem sütunu sağda sabittir. Satırlar ince yatay ayraçlarla ayrılır; fare ve klavye odağında vurgulanır. Öğrenci adıyla sınıf/numara tek hücrededir; sınıf filtreleri ve rapor alanları korunur. Öğretmenlerin uzun sınıf listeleri “+N sınıf” ile açılır. Mobilde temel bilgiler ve işlemler kartlarda, kalan sütunlar “Diğer bilgiler” altında gösterilir; sıralama ve sayfalama kullanılabilir.
- Arama, filtre, sıralama, sayfa boyutu ve sayfa numarası sekme oturumunda saklanır; detaydan dönüşte sayfanın ve tablonun iç kaydırma konumu geri gelir. Filtre, sıralama veya sayfa değişiminde tablonun dikey konumu sıfırlanır. Veli ekranında her çocuğun tercihleri ayrıdır. Finans ve soru listelerindeki hazır filtreler geciken ödemelere veya yanıt süresi aşılmış sorulara hızlı erişim sağlar.
- Sınıf formu **temel bilgiler → branş atamaları → kontrol**, kesin kayıt **öğrenci/sınıf → ödeme planı → kontrol** adımlarına ayrılmıştır. Son onaydan önce kayıt oluşturulmaz. Hatalar alan altında gösterilir; ilk hatalı alana odaklanılır. Geri dönüşte girilen bilgiler korunur.
- Beş rolün menü kategorileri açılıp kapanabilir; tercihler rol bazında sekme oturumunda saklanır. Aktif sayfanın kategorisi, aday ve öğrenci detayları dahil otomatik açılır. Tüm sayfalara ana menüden erişilir. Hızlı erişim alanları bulunmaz; mobilde menü üst bardaki düğmeyle açılır. Kapalı modüllerin bağlantıları ve boş kalan kategoriler gösterilmez. Menü Escape ile kapanır ve odak açan düğmeye döner.

## Mimari ve kapsam

Platform geçişi (ADR 0001, 0002) durumu:

- `packages/school-core` TypeScript'e taşındı. Mobil uygulama da TypeScript'e taşındı (`apps/mobile/tsconfig.json`, `typecheck`; `allowJs` kapalı): `model`, `lib`, `store`, `ui` ve tüm ekranlar.
- `apps/api` iskeleti, Better Auth kimliği, kurum kapsamı, `records` deposu, school-core işlem çalıştırıcısı ve iki örnek kurumun kayıt tohumu hazır; `packages/api-client` ve `packages/react-shared` hazır. Kurum ayarları (`institution_settings`, `/me` akademik yılı), modül kapatma (`requireModule`), rol kapsamlı koleksiyon okuma uçları, `Idempotency-Key` altyapısı ve yazma uçları (iş akışı köprüsü, taksit ödemesi, sınıf yoklaması, kampüs/sınıf/öğretmen arşivi, etüt plan/iptal/yoklama, resmî not; liste `docs/muhendislik/api-tasarimi.md` §1) hazır. İletişim API'si hazır: duyuru yayını/düzeltme/geri çekme/okundu, birebir yazışma (yalnız taraf, imleçli mesajlar, kullanıcı başına hız sınırı) ve yöneticinin gerekçeli, denetim kayıtlı 30 dakikalık erişimi (`apps/api/src/routes/communication.ts`); React ve mobil iletişim ekranları henüz API'ye bağlı değil. Modüllerin kendi kaynak uçları, core'da kişiye göre kapsam fonksiyonları, mobilin API'ye bağlanması ve React ekranlarının API verisine geçmesi sıradaki adımlardır.
- `apps/web-react` iskeleti hazır: Vue ile aynı tokenlar ve ölçülü cam (yalnız sidebar, navbar, menü, diyalog ve toast), beş rolün korumalı kabuğu, kategorili sidebar, avatar menüsündeki hesap sayfaları, kapalı modül yönlendirmesi, 404/hata sınırı, giriş formu, 3B giriş sahnesi ve ortak liste bileşenleri (DataTable, ListFilters, CollectionList, CSV). Oturum gerçek API'ye bağlıdır (Better Auth girişi/çıkışı, `/api/v1/me` → rol, kurum, dönem, modüller ve veli çocukları; çok üyelikte kurum değiştirme, dönüş adresli oturum süresi dolumu). Veli çocuk seçicisi adları velinin kapsamlı öğrenci okumasından alır ve seçimi adreste (`?cocuk=`) taşır. Ekran kontrolü: `node scripts/ekran-kontrol.ts` (`.claude/skills/ekran-kontrol/SKILL.md`).
- React web ilk API'li ekranlar: yönetici Kampüsler & Sınıflar (`/yonetici/subeler`) ve Eğitim Kadrosu (`/yonetici/personel`), yalnız okuma. Sunucu sayfalı tablo, arama/filtre/sıralama/sayfa URL'de, tüm filtrelenmiş sonucu içeren CSV, URL'li sağ panel, yükleniyor/boş/hata/kapalı modül durumları; e2e `tests/e2e-react/yonetim.spec.ts`. Yazma işlemleri, Aktif/Arşiv sekmesi ve Performans/Ortalama sütunları ilgili API uçları gelince eklenir. Liste ekranı kalıbı: `docs/muhendislik/kod-yazim.md`. Diğer ekranlar yer tutucudur.
- React web ilk API'li yazma ekranı: yönetici Finans & Tahsilat (`/yonetici/finans`) ve ön büro Tahsilat Takibi (`/onburo/tahsilat-takip`). Sunucu sayfalı taksit listesi, öğrenci araması, durum filtresi, taksit detayı ve CSV; tahsilat formu `react-shared` `useApiCommand` kalıbıyla çalışır (`Idempotency-Key`, çift tıklama kilidi, başarıda liste tazeleme, 409 `invoice_already_paid` Türkçe mesajı). e2e `tests/e2e-react/finans.spec.ts`. Eksik API uçları `TODO(api-filter-invoice-status)`, `TODO(api-search-joined)`, `TODO(api-aggregate)` ile işaretlidir; dekont PDF'i sonra. Yazma kalıbı: `docs/muhendislik/kod-yazim.md`.
- React web öğrenme okuma ekranları (öğretmen ödev/materyal/quiz, öğrenci Ödevlerim/Materyaller/Quiz & Testler, veli Akademik Takip'in ödev durumu ve quiz sonuçları sekmeleri): yalnız okuma, API'li liste kalıbı; ödev durumu core `homeworkStatus`, öğretmen quiz ortalaması cevaplardan core `gradeQuiz` ile hesaplanır, kapsam sunucuda core'dan gelir. e2e `tests/e2e-react/ogrenme.spec.ts`. Eksikler `TODO(api-quiz-grading)`, `TODO(api-aggregate)`, `TODO(api-filter-level)` ile işaretlidir; yazma işleri (teslim, quiz çözme, oluşturma) ADR 0003 sonrası.
- React web akademik okuma ekranları (yalnız okuma): öğretmen Sınıflarım + Not listesi, Yoklama geçmişi ve Ders Programım; öğrenci Notlarım, Devamsızlığım ve Ders Programım; veli Çocuklarım ve Akademik Takip (notlar/devamsızlık/program sekmeleri, seçili çocuk `?cocuk=`). Kapsamı sunucu uygular (kapsam dışı ayrıntı adresi "Kayıt bulunamadı"); ders ortalaması, devam özeti ve çocuk kartları kayıtlardan hesaplanır, iptal dersler programda görünmez. e2e `tests/e2e-react/akademik.spec.ts`, birim `apps/web-react/tests/academic-rows.test.ts`. Yoklama `date` ve notlarda `classId` filtresi API'de yoktur; geçici çözümler `TODO(api-filter-date)` ve `TODO(api-filter-class)` ile işaretlidir. Akademik yazma: öğretmen Yoklama sayfasında ders verdiği sınıfın bugünkü yoklamasını alır (varsayılan "Geldi", tek gönderim, aynı gün ikinci gönderim günceller; `If-Match` sınıf sürümü) ve Not listesinde "Not gir" ile resmî not girer, not panelinde gerekçeli düzeltme yapar (`If-Match` not sürümü; 409 "Kayıt değişti"). Komut kancaları `packages/react-shared/src/use-academic-commands.ts`, e2e `tests/e2e-react/akademik-yazma.spec.ts`, birim `apps/web-react/tests/academic-write.test.ts`. Yönetici yoklama düzeltmesi (gerekçe zorunlu) için React'te sayfa henüz yoktur.
- React web Genel Bakış (`/<rol>/dashboard`, beş rol): sayaçlar yalnız sunucu sayımından (`GET /collections/:c/counts`, react-shared `useCollectionCounts` ve `useCollectionCountSeries`), kısa listeler sunucu sıralı en çok 20 kayıttır; koleksiyon istemciye çekilmez. Yönetici: aktif öğrenci/sınıf/öğretmen, bekleyen tahsilat, taksit dağılımı, bugünkü yoklama, son kayıtlar, kampüs doluluğu. Ön büro: gecikmiş/yaklaşan/tahsil edilen taksit, kısa listeler, aday aşamaları. Öğretmen: öğrenci/sınıf/bugün gelmeyen, bugünkü dersler, teslim bekleyen ödevler. Öğrenci ve veli: not ortalaması, devamsızlık, teslim edilen ödev, son 8 haftanın devamsızlık grafiği (recharts 3.10.1, yalnız çizilirken `import()` ile ayrı parça; veri yoksa çizilmez, yanında metin özeti), veliye çocuğun bakiyesi; öğrenci ödeme bilgisi görmez ve taksit isteği atılmaz. Kapalı modülün kartı çizilmez. Paket boyutu: ilk JS 148 kB gzip, DashboardPage 7,7 kB, grafik parçası 91 kB gzip. e2e `tests/e2e-react/dashboard.spec.ts`, birim `apps/web-react/tests/dashboard-model.test.ts`. Eksik API süzgeçleri `TODO(api-paid-at-range)`, `TODO(api-due-date-range)`, `TODO(api-filter-cancelled)`, `TODO(api-joined-fields)`, `TODO(api-aggregate-monthly)` ile işaretlidir (bugünkü/aylık tahsilat, yaklaşan ödev, iptal ders, bağlı ad). Kalıp: `docs/muhendislik/kod-yazim.md`.
- React web okul iş akışı ortak sayfası: Yemek Menüsü, Okul Takvimi, Kulüpler & Sosyal Gelişim, Hedef & Gelişim Planı, Rehberlik & Takip, Deneme Sınavları, Kayıt Yenileme, Program Yönetimi, Çalışma Planı ve Okul Servisi bağlı (`pages/workflows/`). Satır, detay, oluşturma işlemleri ve form alanları core `workflow-presentation.ts`'ten; koleksiyonlar kapsamlı okunup core State kurulur, sayfalama istemcidedir (`TODO(api-workflow-rows)`, yöneticide ~1440 ders satırı için `TODO(perf)`). Form react-hook-form + core Zod şeması, gönderim `useWorkflowCommand` (`If-Match`, `Idempotency-Key`, çift tıklama kilidi, alan hataları). Deneme CSV aktarımında şablon indirme, dosya seçme ve ön kontrol; kayıt yenilemede core `renewalQuote` ücret özeti. Kapalı modül adresi "Modül kullanıma kapalı" der. e2e `tests/e2e-react/is-akislari*.spec.ts`, birim `apps/web-react/tests/workflow-state.test.ts`. Optik değerlendirme ve otomatik etüt ayrı ekranlardır (W7b); sözleşme PDF'i `TODO(pdf-contract)`; core ayrıntı eylemleri üç kimliksiz komuta kayıt kimliği verdiği için ortak sayfa onu düşürür (`TODO(core-record-id)`).
- Mobil API modu: `EXPO_PUBLIC_API_URL` verilince uygulama gerçek API'ye bağlanır; verilmezse çevrimdışı demo aynen çalışır (geçersiz adreste yapılandırma hatası ekranı). Better Auth Expo istemcisiyle e-posta/parola girişi, oturum çerezi yalnız `expo-secure-store`'da (AsyncStorage'a yalnız tema), `/api/v1/me` → rol/kurum/modüller/veli çocukları, avatar menüsünde kurum değiştirme ve tema, kullanıcı çıkmadan kapanan oturumda "süre doldu" bildirimi. Kurum değişince kuruma bağlı önbellek ve gezinme yığını sıfırlanır. API'li ilk ekranlar öğretmen Sınıflarım ve veli Akademik Takip (çocuk seçici + notlar), salt okuma; diğer roller ve ekranlar demo modundadır. Ayrıntı `docs/mobile-release.md`.
- Statik yayın (`pnpm run deploy`) yalnız Vue derlemesini (`apps/web/dist`) yayımlar. Aşağıdaki bölüm Vue demosunu anlatır.

Görsel düzen düz renkler üzerine kuruludur: saf beyaz (`#FFFFFF`) zemin, koyu safir mavi (`#1E3A8A`) menü/ana işlem rengi, turuncu (`#F97316`) aksan, ince kenarlıklar ve yuvarlak köşeler. Açık ve koyu temada renk geçişleri kullanılmaz. Slogan bandı ve veriye dayanmayan mini grafikler kaldırılmıştır. Öğrenci, veli ve öğretmen panellerinde ders programı ile bekleyen işler üst bölümdedir; grafikler kayıtlı veriyi gösterir. Büyük para tutarları tek satırda, uzun ders adları doğal satırlarla gösterilir.

Sidebar ve navbar kenarlardan 12 px ayrılmış, yuvarlak köşeli yüzeylerdir. Aktif menü öğesi metne göre genişleyen kısa turuncu pill ile vurgulanır; kategoriler ince ayraçlarla ayrılır. Navbar solda sayfa yolunu, sağda rol/tema/bildirim/avatar kapsülünü gösterir. Telefonlarda üst bar iki satıra geçer; yatay telefonda menüye daha çok yer bırakılır. Bildirim listesi ekran yüksekliğine göre kaydırılabilir.

İkincil butonlar %9 safir dolgulu, arşiv işlemleri nötr; yalnızca sayfanın ana ekleme aksiyonları tam yuvarlaktır. Dashboard içerikleri 2:1 yerleşir, KPI boyutları eşit kalır; seçili özetler %5 ton farkıyla kenarlıksız görünür. Tahsilat ve öğrenci/veli not ortalaması kartlarındaki mini grafikler gerçek kayıtlardan türetilir, boş veri için uydurma çizgi üretilmez. Avatar renkleri Türkçe küçük harfe ve NFC biçimine dönüştürülmüş tam addan hesaplanır; aynı kişi üst bar, sidebar ve listelerde aynı rengi kullanır. Gecikmiş taksitler, yüksek risk ve SLA ihlalleri durum etiketleriyle gösterilir. Kart, takvim ve tablo satırlarında dekoratif renkli kenar çizgileri kullanılmaz.

- `apps/web/src/styles/tokens.css`: temel renkler, açık/koyu tema ve ortak ölçüler. `--font-size-reduction: 2px`, giriş ve tüm rol ekranlarındaki yazıları aynı miktarda küçültür; kontrol boyutları ve PDF şablonları korunur. Sidebar menü bağlantıları 11 px, grup başlıkları 10 px olarak ayarlanmıştır.
- `apps/web/src/styles/presentation.css`: menü, kart, form, tablo ve ekran boyutlarına göre görsel düzen.
- `apps/web/src/components/LessonCover.vue`: matematik ve fen için düz renkli, kodla çizilen video kapakları.
- `apps/web/src/components/LessonAgenda.vue`: ders ikonlarıyla günlük program listesi.

Girişin 3B hareketi korunur; parlamalar ve geçişli yüzeyler kaldırılmıştır. Azaltılmış hareket tercihinde sahne durur. Oynat/durdur düğmesi önceki isteğe uygun olarak yorum satırındadır. Bu tasarım yenilemesinde yeni bağımlılık eklenmemiştir.

- `apps/web/src/data/curriculum.js`: dersler, kazanımlar ve çalışma içerikleri.
- `data/seed.js`, `data/question-bank.js`: tek ilişkili veri kümesi, öğrenci geçmişleri ve cevap anahtarlı sorular.
- `stores/demo.js`: ortak Vue state, toast ve sekme senkronizasyonu.
- `lib/demo-persistence.js`: başlangıç verisine göre değişikliklerin kalıcı saklanması.
- `lib/school-management.js`: kampüs/sınıf/öğretmen doğrulaması, güvenli arşiv ve aktarım.
- `lib/domain.js`: kayıt, taksit, ödeme, yoklama ve puanlama kuralları.
- `modules/navigation.js`: rol, sayfa ve modül kaydı.
- Ortak bileşenlerde arama/sıralama/sayfalama, grafik, takvim, odak yönetimli modal ve bildirimler.

Para kuruş cinsinden tamsayıdır; `1.234,56 ₺` biçiminde gösterilir. Zaman damgaları UTC ISO 8601, ekranlar `Europe/Istanbul` kullanır. Açık tema varsayılandır. Yuvarlatılmış yüzeyler, hafif gölgeler ve sakin renkler her iki temada uygulanır.

Hazır videolar sunulan gerçek medya dosyalarıdır ve dış servis gerektirmez. Yeniden üretim betiği `scripts/generate-lessons.py`; macOS Yelda Türkçe sesi, FFmpeg ve Pillow kullanır. Bu araçlar uygulamayı çalıştırmak için gerekli değildir. Ders görselleri ve metinleri bu demo için hazırlanmıştır; sesler bilgisayar üretimidir.

Kullanıcı dosya yüklemeleri isim/boyut/tür metadata'sını saklar; içerik bir sunucuya gönderilmez. PDF/CSV indirmeleri gerçek örnek dosyalar üretir. Gerçek tahsilat, SMS/e-posta gönderimi, JWT ve WebRTC kapsam dışıdır. Rol URL'leri demo gezintisi içindir; güvenlik sınırı oluşturmaz.

Arayüz, Metis panel yaklaşımını izleyen bağımsız Vue bileşenlerinden oluşur. Font ve ikonlar yereldir; Noto Sans lisansı [OFL.txt](apps/web/public/fonts/OFL.txt) dosyasındadır. Önizleme için `pdfjs-dist@6.3.289` sabit sürümü eklenmiştir ([Apache-2.0 lisansı](https://github.com/mozilla/pdf.js/blob/master/LICENSE)). Paket güncelliği ve derleme boyutu kontrol edilmiştir; görüntüleyici ayrı, yaklaşık 131 KB gzip JavaScript parçası ve 1,27 MB worker olarak yüklenir. En az Node.js 22.13 gerekir; proje `.nvmrc` ile Node.js 24 kullanır.

## Yayın

- Adres: **https://demo.onurevis.com**; sunucu: `45.136.6.28`.
- 6 Ekim 2026 aktif web sürümü: `20261006T174028Z-14263`. Optik değerlendirme, otomatik etüt ve diğer okul iş akışları yayındadır. Önceki sürüm `20260927T212127Z-3246` ve Nginx yapılandırması geri dönüş için korunur.
- Statik Vue build'i Nginx üzerinden sunulur. Sunucuda Node.js uygulama süreci, veritabanı veya gerçek kullanıcı/ödeme verisi bulunmaz; demo değişiklikleri ziyaretçinin tarayıcısında saklanır.
- Yayın komutu: `pnpm run deploy`. Yerel SSH yapılandırmasındaki `abbara-server` hedefini kullanır; başka bir SSH alias'ı için `pnpm run deploy -- sunucu-aliasi` verilebilir. SSH anahtarları projeye eklenmez.
- Komut lint, format, birim testi ve build kontrollerinden sonra yalnızca `dist` dosyalarını `/var/www/kampus-demo/releases/<surum>` dizinine aktarır. Siteye ait yapılandırmalar ayrı `deploy/<surum>` dizinindedir. `current` sembolik bağlantısı atomik olarak değiştirilir; başarısız aktivasyonda önceki sürüm/yapılandırma geri yüklenir.
- Eski sürümler korunur. Önceki sekmelerin dinamik JavaScript yüklemeleri bozulmasın diye hash içeren dosyalar ortak `assets` dizininde tutulur. HTML ve sağlık yanıtları yeniden doğrulanır; hash içeren dosyalar uzun süre önbelleklenir.
- Nginx ayarları: `deploy/http.conf`, `deploy/https.conf`, `deploy/site.conf`. Beş rolün doğrudan URL'leri SPA girişine yönlenir. Videolar aralık isteklerini destekler; PDF.js `.mjs` worker dosyaları JavaScript MIME türüyle sunulur.
- HTTPS: Let's Encrypt; HTTP otomatik HTTPS'e yönlenir. Mevcut `certbot.timer` sertifikayı yeniler; başarılı yenilemede Nginx yapılandırması doğrulanıp yeniden yüklenir.
- Sağlık kontrolü: `https://demo.onurevis.com/healthz`; yanıt aktif sürüm kimliğini içerir. Mevcut `sunucu.onurevis.com` izleme paneli sunucunun CPU/RAM/disk/uptime ve Nginx servis durumunu toplar. Statik site için ayrı bir süreç veya izleme ajanı gerekmez.

Önceki sürüme dönüş için `ssh abbara-server 'ls -1 /var/www/kampus-demo/releases'` ile sürüm kimliğini seçip aşağıdaki komutta `<surum>` alanlarını değiştirin. Aktivasyon aynı doğrulama ve otomatik geri dönüş mekanizmasını kullanır:

```bash
ssh abbara-server 'bash /var/www/kampus-demo/deploy/<surum>/activate.sh <surum>'
```

## Doğrulama

`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm --filter @kampus/api test`, `pnpm --filter @kampus/api-client test`, `pnpm --filter @kampus/react-shared test` ve `pnpm build` temel kontrollerdir. 30 Ekim 2026: 440 birim testi (web-react dahil; school-core kapsamı satır %97,8, dal %92,4), 291 API testi (PGlite; yazma uçları, tarih aralığı/iptal/notlanmamış süzgeçleri, aylık sayım gruplaması, bağlı ad alanları, iletişim uçları (taraf sınırı, iki velide ayrı yazışma, gerekçeli yönetici erişimi, duyuru hedef kitlesi ve geri çekme, hız sınırı), kurum türü modül kısıtı, yoklama/not düzeltme geçmişi ve öğrenci/veliden ayıklanması, SQL arama adayının üst küme testi dahil), PostgreSQL 16 `test:pg` 10 test (kurum kilidi, yazma sırası, kilitlenmede 409, boyut kısıtı, eşzamanlı Idempotency-Key, eşzamanlı iki sınıf yoklamasında öğrenci başına tek kayıt), 23 api-client ve 94 react-shared testi, 128 React e2e senaryosu (PostgreSQL 16 + API; Genel Bakış 16, finans 14, akademik 19, akademik yazma 11, yönetim 19, öğrenme 24, okul iş akışları 6, giriş/oturum/yönlendirme/kurum 19) geçti; PostgreSQL 16 üzerinde migrate, iki kez seed (kurum başına 27.464 kayıt, ikincisinde 0 yeni), sağlık/giriş ve eşzamanlı iki ödemede 409 duman testi başarılı. Koleksiyon okuma ölçümü (PG16, örnek kurumun tam verisi; yönetici, iki öğretmen ve iki çocuklu veli): öğretmen, öğrenci ve veli kişisel koleksiyonları core kapsamıyla okur (kapsam dışı ayrıntı 404, iç not yalnız rehberlik görevlisinde); 11.760 kayıtlık `grades` yönetici filtresi 174 ms → 14 ms; süzgeçsiz yönetici listesi SQL sayfasıyla 58–154 ms → 21–25 ms, yönetici `q` (bağlı adla dahil) ~260–590 ms → 165–200 ms, öğretmen ~60 ms, veli ~20 ms (makine yükü 40–50; ayrıntı ve kalıcı arama kolonu notu `docs/muhendislik/api-tasarimi.md` §3, `TODO(perf)`). Tarayıcı akışları `pnpm test:e2e` ile çalıştırılır. Mobil sürümün native kontrol kapsamı [Android teslim notlarında](docs/mobile-release.md) açıklanır.

6 Ekim 2026 optik/etüt teslim kontrolü: lint, format ve web derlemesi başarılı; 65 birim testi ve 58 tarayıcı senaryosu geçti. Yayın öncesinde tüm 58 tarayıcı senaryosu tekrar geçti. Canlı adres üzerinde 14 senaryo; beş rolün masaüstü/dar ekran sayfaları, optik/etüt işlemleri, video ve PDF akışlarını doğruladı. Sağlık yanıtı sürümle eşleşti; HTTPS yönlendirmesi, video aralık isteği ve PDF worker MIME türü kontrol edildi.

Kritik testler finansal doğruluk, mükerrer ödeme, kayıt atomikliği, yoklama, puanlama, ders/branş ilişkileri, çakışmasız program, kampüs/öğretmen/sınıf aktarımı ve değişikliklerin kayıpsız saklanmasını kapsar. Optik/etüt testleri hatalı dosyanın atomik reddini, kitapçık ve kazanım hesaplarını, mükerrer aktarımı, rol/çocuk kapsamını, çakışmasız gruplamayı, yoklamayı ve kalıcılığı doğrular. Belge testleri finansal toplamları, altı PDF şablonunun içerik/sayfa sınırlarını, uzun metinleri, tekrarlanan tablo başlıklarını ve filtre sınırlarını da doğrular.

Playwright senaryoları beş rolün 97 sayfasını masaüstü ve mobilde açar; rol geçişleri, yönetici ekleme/düzenleme/arşiv/geri alma, ders filtreleri, soru/mesaj yönlendirme, PDF önizleme ve indirmeleri, bileşik filtreler, filtrelenmiş CSV, sayfalama, mobil/koyu tema, gerçek video oynatma ve ilerleme kalıcılığını doğrular. Yeni senaryolar listeye dönüşte durum/konum, çocuk bazında filtre ayrımı, sabit işlemler, mobil taksit seçimi, adımlı form doğrulaması, menü klavye erişimi, PDF hata/yeniden deneme, dolu sayfa çizimi, çok sayfalı önizleme ve yazdırma penceresinin hazırlanmasını kapsar. Fiziksel yazıcıdan çıktı alınması test kapsamı dışındadır.

Proje kuralları ve planı: [CLAUDE.md](CLAUDE.md).

### Mobil 1.4.0 · Yeni tasarım ve okul iş akışları

Safir üst başlık, yumuşak mavi-gri zemin ve beyaz kartlarla yenilenen arayüz; hamburger menü yerine ana ekranda kategori kartları, kategori ekranında modül kartları ve sağ üstte isim/hesap menüsü. Okul iş akışı modüllerinin tamamı (rehberlik, deneme sınavları, hedef/gelişim planı, kayıt yenileme, program, çalışma planı, takvim, servis, yemek, kulüpler, optik değerlendirme ve otomatik etüt) telefonda çalışır. APK sürüm kodu 7. Ayrıntılar: [Mobil sürüm notları](docs/mobile-release.md).

### Mobil 1.3.0 · İş akışları ve taslaklar

Ders programı günlük saat akışına, mesajlar konuşma listesi/sohbete, videolar ders filtreli kütüphaneye dönüştürüldü. Metin alanları ortak klavye düzenini kullanır. Ödev/yanıt/mesaj/form/yoklama taslakları rol, çocuk, kayıt ve sınıf/gün bazında cihazda saklanır. Açık/koyu/sistem teması, beş rolün modülleri ve çevrimdışı kayıt korunur. APK sürüm kodu 6; canlı web yayını değiştirilmedi. Ayrıntılar: [Mobil sürüm notları](docs/mobile-release.md).

## Teslimler ve proje çıktıları

- Güncel Android uygulaması: [kampus-1.4.0.apk](apklar/kampus-1.4.0.apk).
- Yatırımcı sunumu: [PowerPoint](sunumlar/kampus-yatirimci-sunumu-v2.pptx), [PDF](sunumlar/kampus-yatirimci-sunumu-v2.pdf) ve [yeniden üretim adımları](sunumlar/OKU.md). Kullanılan ekran görüntüleri `sunumlar/ekran-goruntuleri/`, üretim betikleri `scripts/sunum/` içindedir.
- Menü/kod rehberi: [PDF](docs/kampus-menu-ve-kod-rehberi.pdf), [sayfa listesi](docs/sayfalar.md).

`artifacts/`, `test-results/`, `playwright-report/`, mobil `dist/`, `.expo/` ve Android `build/`/`.cxx/` dizinleri yeniden üretilebilen yerel çıktılardır; kaynak kod veya teslim arşivi olarak kullanılmaz. `pnpm preview` çalışan web derlemesini `apps/web/dist/` içinden sunar. Eski APK ve sunum kopyaları yerine güncel teslimler tutulur. Android derleme önbellekleri temizlendikten sonraki ilk APK derlemesi daha uzun sürebilir.
