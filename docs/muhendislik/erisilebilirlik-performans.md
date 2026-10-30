# Erişilebilirlik ve performans

Hedef: WCAG 2.2 AA (web ve mobil) ve aşağıdaki bütçeler. Bir ekran ikisini de karşılamadan "bitti" sayılmaz.

## 1. WCAG 2.2 AA kontrol listesi

Her yeni ekran ve önemli değişiklikte PR açıklamasında işaretlenir. Kolon: W = web, M = mobil.

### Algılanabilir

| Ölçüt                             | W   | M   | Kontrol                                                                                                           |
| --------------------------------- | --- | --- | ----------------------------------------------------------------------------------------------------------------- |
| 1.1.1 Metin dışı içerik           | ✓   | ✓   | Anlamlı ikon/görsel etiketli; süs ikonu `aria-hidden` / `accessibilityElementsHidden`                             |
| 1.2.1–1.2.5 Zaman tabanlı medya   | ✓   | ✓   | Video kitaplığında altyazı; ses içerikte metin dökümü (dinleme sınavında döküm yanıt gönderildikten sonra açılır) |
| 1.3.1 Bilgi ve ilişkiler          | ✓   | ✓   | Tablo `th` + `scope`; form alanı görünür etiketle bağlı; başlık düzeyleri sıralı                                  |
| 1.3.4 Yön                         | ✓   | ✓   | Dikey/yatay kilitlenmez (mobil `orientation: default` korunur)                                                    |
| 1.3.5 Girdi amacı                 | ✓   | ✓   | `autocomplete` (`email`, `current-password`, `tel`) / `textContentType`, `autoComplete`                           |
| 1.4.1 Rengin kullanımı            | ✓   | ✓   | Durum rozeti renkle birlikte metin taşır; grafik çizgisi desen veya etiketle ayrılır                              |
| 1.4.3 Kontrast (metin)            | ✓   | ✓   | 4,5:1; büyük metin 3:1. Açık **ve** koyu tema ayrı ölçülür                                                        |
| 1.4.4 Metni yeniden boyutlandırma | ✓   | ✓   | Web %200 yakınlaştırmada kayıp yok; mobil en büyük sistem yazı boyutunda alan/işlem görünür                       |
| 1.4.10 Yeniden akış               | ✓   | —   | 320 CSS px genişlikte yatay kaydırma yok (veri tabloları hariç; tablo kendi kabında kayar)                        |
| 1.4.11 Metin dışı kontrast        | ✓   | ✓   | Kontrol sınırı, odak halkası, grafik öğesi 3:1                                                                    |
| 1.4.12 Metin aralığı              | ✓   | —   | Satır yüksekliği 1,5 ve harf aralığı artırılınca içerik kesilmez                                                  |
| 1.4.13 Üzerine gelince içerik     | ✓   | —   | İpucu `Esc` ile kapanır, üzerine gelinebilir, kendiliğinden kaybolmaz                                             |

### Kullanılabilir

| Ölçüt                          | W   | M   | Kontrol                                                                                |
| ------------------------------ | --- | --- | -------------------------------------------------------------------------------------- |
| 2.1.1 Klavye / 2.1.2 Tuzak yok | ✓   | ✓   | Her işlem klavyeyle (mobilde harici klavye ve TalkBack ile); pencere `Esc` ile kapanır |
| 2.2.1 Zamanlama                | ✓   | ✓   | Toast'taki önemli bilgi başka yerde de görünür; quiz süresi varsa uzatma seçeneği      |
| 2.3.1 Üç parlama               | ✓   | ✓   | Yanıp sönen içerik yok                                                                 |
| 2.4.1 Blok atlama              | ✓   | —   | "İçeriğe geç" bağlantısı                                                               |
| 2.4.2 Sayfa başlığı            | ✓   | ✓   | Her rota benzersiz `document.title`; her ekran başlığı okunur                          |
| 2.4.3 Odak sırası              | ✓   | ✓   | Görsel sırayla aynı; pencere kapanınca odak açan öğeye döner                           |
| 2.4.6 Başlık ve etiketler      | ✓   | ✓   | Etiketler amacı anlatır ("Kaydet" değil "Hedefi kaydet" gerektiğinde)                  |
| 2.4.7 Odak görünür             | ✓   | ✓   | Görünür odak halkası; `outline: none` yalnız yerine eşdeğer halka varsa                |
| 2.4.11 Odak gizlenmez (asgari) | ✓   | ✓   | Sabit başlık, alt çubuk, klavye veya toast odaklı öğeyi örtmez                         |
| 2.5.1 İşaretçi hareketleri     | ✓   | ✓   | Çok parmaklı/yol hareketinin tek dokunuşla karşılığı var                               |
| 2.5.3 Addaki etiket            | ✓   | ✓   | Erişilebilir ad görünür etiketi içerir (e2e seçicileri buna dayanır)                   |
| 2.5.7 Sürükleme                | ✓   | ✓   | Sürükle-bırak (program, etüt yerleşimi) düğmeyle de yapılabilir                        |
| 2.5.8 Hedef boyutu (asgari)    | ✓   | ✓   | Web en az 24×24 CSS px; mobil proje kuralı 48×48 dp                                    |

### Anlaşılabilir

| Ölçüt                                 | W   | M   | Kontrol                                                                               |
| ------------------------------------- | --- | --- | ------------------------------------------------------------------------------------- |
| 3.1.1 Sayfa dili                      | ✓   | ✓   | `<html lang="tr">`                                                                    |
| 3.1.2 Bölüm dili                      | ✓   | ✓   | İngilizce okuma/dinleme içeriği `lang="en"` (mobilde `accessibilityLanguage="en-US"`) |
| 3.2.1–3.2.2 Odakta/girdide değişiklik | ✓   | ✓   | Alan seçimi tek başına sayfa değiştirmez veya gönderim yapmaz                         |
| 3.2.6 Tutarlı yardım                  | ✓   | ✓   | Yardım/iletişim bağlantısı her sayfada aynı yerde                                     |
| 3.3.1 Hata tanımlama / 3.3.3 Öneri    | ✓   | ✓   | Alan hatası metinle, alanın yanında, nasıl düzeltileceğini söyler; özet hata en üstte |
| 3.3.2 Etiket ve yönerge               | ✓   | ✓   | Zorunlu alan ve biçim (`GG.AA.YYYY`) etikette                                         |
| 3.3.4 Hata önleme                     | ✓   | ✓   | Ödeme, not ve kalıcı işlemlerde onay adımı veya geri alma                             |
| 3.3.7 Tekrarlı giriş                  | ✓   | ✓   | Çok adımlı formda daha önce girilen bilgi yeniden istenmez (taslak korunur)           |
| 3.3.8 Erişilebilir kimlik doğrulama   | ✓   | ✓   | Parola yapıştırılabilir, parola yöneticisi çalışır, bulmaca/CAPTCHA yok               |

### Sağlam

| Ölçüt                 | W   | M   | Kontrol                                                                                                     |
| --------------------- | --- | --- | ----------------------------------------------------------------------------------------------------------- |
| 4.1.2 Ad, rol, değer  | ✓   | ✓   | Özel bileşenler doğru rol/durum taşır (`aria-expanded`, `accessibilityState`); yerel öğe önceliklidir       |
| 4.1.3 Durum mesajları | ✓   | ✓   | Toast `role="status"` (hata `role="alert"`); mobilde `accessibilityLiveRegion` / `announceForAccessibility` |

Proje kuralları (WCAG üstü): azaltılmış hareket tercihine uyulur (web `prefers-reduced-motion`, mobil `useReducedMotion`); görünmeyen sekmede animasyon durur; web 390 px ve mobil 320 dp genişlikte taşma yok. Hazır bileşenlerin (Radix/shadcn, React Navigation) verdiği odak yönetimi, ARIA rolleri ve klavye davranışı ezilmez; özelleştirme bunları bozuyorsa yapılmaz.

### Cam yüzey (ölçülü Liquid Glass, ADR 0002)

- Cam yalnız yüzen katmanda (sidebar, navbar, menü, popover, modal/sağ panel zemini, toast, mobil üst başlık); tablo, form, belge, PDF ve uzun metin opaktır.
- Kontrast, cam altından geçebilecek **en kötü** içerikle ölçülür (beyaz ve koyu tablo satırı, safir/turuncu rozet); metin 4,5:1, ikon ve kontrol sınırı 3:1. Tutmuyorsa token zemininin opaklığı artırılır; bulanıklığa güvenilmez.
- `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, `forced-colors: active` ve `@supports not (backdrop-filter: blur(1px))` durumlarında yüzey opak token zeminine döner. Mobilde iOS "Saydamlığı Azalt" ayarı (`AccessibilityInfo.isReduceTransparencyEnabled`) aynı sonucu verir; Android'de cam yoktur.
- Odak halkası cam üstünde de 3:1 ve görünürdür; cam katman odaklı öğeyi örtmez (2.4.11).

### Ölçüm

- Otomatik: e2e'de her ana sayfa için axe taraması (`@axe-core/playwright`, öneri); `serious` ve `critical` ihlal testi düşürür. Kurallar dışı bırakılacaksa gerekçesiyle test içinde.
- Lint: `eslint-plugin-jsx-a11y` (öneri, web).
- Elle (her sürümde, kontrol listesiyle): yalnız klavyeyle ana akış; web'de NVDA + Firefox veya VoiceOver + Safari; Android'de TalkBack ve en büyük yazı boyutu; koyu tema kontrastı.
- Otomatik araç ölçütlerin yaklaşık üçte birini yakalar; elle kontrol atlanmaz.

## 2. Performans bütçeleri

### Web (`apps/web-react`)

Saha değerleri 75. yüzdelik; laboratuvar referansı orta seviye Android telefon, 4G (Lighthouse mobil profili). Yönetim ekranları için masaüstü profili.

| Ölçüt                     | Bütçe                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| LCP                       | ≤ 2,5 sn                                                              |
| INP                       | ≤ 200 ms                                                              |
| CLS                       | ≤ 0,1                                                                 |
| İlk yükleme JS (gzip)     | ≤ 200 KB (giriş + kabuk + ilk rota)                                   |
| Rota parçası JS (gzip)    | ≤ 100 KB                                                              |
| CSS (gzip)                | ≤ 50 KB                                                               |
| Font                      | Inter woff2, latin-ext alt kümesi, en fazla 3 ağırlık                 |
| 100 satırlık tablo çizimi | ≤ 100 ms; 200 satırdan büyük listeler sayfalanır veya sanallaştırılır |

- pdfjs-dist ve jspdf ilk yüklemede yoktur; belge açıldığında `import()` ile gelir. `recharts` yalnız grafik içeren rotanın parçasındadır; `date-fns` fonksiyon bazında içe aktarılır.
- Rotalar `react-router` `lazy` ile bölünür; kabukta yalnız ortak düzen ve sık kullanılan shadcn bileşenleri kalır.
- Cam maliyeti: aynı anda en fazla 3 bulanık katman; bulanıklık yarıçapı token değeridir. Kaydırılan içeriğin üstündeki katmanda INP ve kare süresi düşük güçlü cihazda ölçülür; bütçe aşılırsa katman opak yedeğe döner.
- Görsel ve font boyutu sabit (yer tutucu) verilir; CLS üretmez.

### API (`apps/api`)

Örnek ölçek: 2.000 öğrenci, 120 sınıf, 150 personel, bir öğretim yılı yoklama ve notu olan kurum.

| Ölçüt                                | Bütçe                                   |
| ------------------------------------ | --------------------------------------- |
| Okuma uçları p95                     | ≤ 200 ms                                |
| Yazma/komut uçları p95               | ≤ 400 ms                                |
| Tüm uçlar p99                        | ≤ 1 sn                                  |
| Giriş p95 (scrypt dahil)             | ≤ 500 ms                                |
| CSV/DAT içe aktarma (1 MB)           | ≤ 5 sn                                  |
| Liste yanıt gövdesi                  | ≤ 100 KB                                |
| İstek başına sorgu sayısı            | ≤ 10                                    |
| Komut için yüklenen `records` verisi | ≤ 5 MB (aşılırsa normalleştirme ölçütü) |

### Mobil (`apps/mobile`)

Referans cihaz: orta seviye Android (4 GB RAM), release derlemesi.

| Ölçüt                        | Bütçe                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Soğuk açılış → ilk etkileşim | ≤ 2,5 sn                                                         |
| Sıcak açılış                 | ≤ 1 sn                                                           |
| Dokunma geri bildirimi       | ≤ 100 ms                                                         |
| Ekran geçişi                 | ≤ 300 ms, kare düşmesi yok                                       |
| Liste kaydırma               | 60 fps; JS karesi 16 ms'yi aşmaz                                 |
| APK boyutu                   | 1.4.0 taban; %10'dan fazla artış commit gövdesinde gerekçe ister |

### Ölçüm yöntemi

| Alan  | Laboratuvar                                                                                                           | Sürekli                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Web   | `vite build` + `vite preview` üzerinde Lighthouse (giriş, panel, öğrenci listesi); Chrome DevTools Performans ile INP | CI'da paket boyutu kontrolü (gzip, bütçe aşımında kırmızı); saha ölçümü için `web-vitals` + kendi ucumuz (öneri) |
| API   | Örnek ölçekli seed üzerinde `autocannon` yük testi (öneri), `EXPLAIN (ANALYZE, BUFFERS)`                              | pino `responseTime` alanından uç bazlı p95; 100 ms üstü sorgu logu                                               |
| Mobil | `adb shell am start -W` ile `TotalTime` (5 ölçümün ortancası); Android Studio profiler / Perfetto ile kare süresi     | Her sürüm notunda (`docs/mobile-release.md`) açılış süresi ve APK boyutu                                         |

- Ölçüm her zaman üretim derlemesinde yapılır; geliştirme sunucusu ölçümü sayılmaz.
- Bütçeyi aşan değişiklik ya düzeltilir ya da commit gövdesinde ölçümle gerekçelendirilip bütçe bu belgede açıkça güncellenir.
