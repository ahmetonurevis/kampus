# Kampüs Android · 1.4.0

Beş rolün mevcut modülleri React Native ile telefona uyarlandı. APK, Expo Go, geliştirme sunucusu veya internet bağlantısı gerektirmeden çalışır. Web yayını değişmedi.

## 1.4.0 yeni tasarım ve okul iş akışları

- **Tasarım:** safir üst başlık, yumuşak mavi-gri sayfa zemini, beyaz kartlar ve turuncu aksan. Açık/koyu tema korunur; gradyan ve dekoratif renkli kenar çizgisi yoktur.
- **Menü:** hamburger menü kalktı. Ana ekranda kategoriler kart olarak gelir; karta dokununca kategori ekranı o kategorinin modüllerini kart olarak açar. İç sayfalarda geri tuşu ve "Modüller" düğmesi bulunur.
- **Hesap:** "Hesabım" kategorisi kalktı; Ayarlar, tema, rol değiştirme ve oturum kapatma sağ üstteki isim/avatar menüsündedir. Öğrenci ödemeleri telefonda gösterilmez (web menüsü değişmedi).
- **Okul iş akışları:** rehberlik, deneme sınavları, hedef/gelişim planı, kayıt yenileme, program yönetimi, çalışma planı, okul takvimi, servis, yemek ve kulüpler ortak liste/detay/form ekranıyla; optik değerlendirme ve otomatik etüt kendi ekranlarıyla telefonda çalışır. İşlemler kontrol adımlıdır ve atomik kaydedilir. Optik dosyalar cihazdan seçilir (CSV/DAT/TXT, 1 MB, UTF-8 veya Windows-1254).
- Ortak paket `school-core` 1.3.0: birleşik menü, hedef/gelişim planı modülü, metin çözücü. Veri/snapshot biçimi ve imza korundu; 1.3.0 üzerine yükleme kayıtları ve tercihleri korur.

1.4.0 doğrulaması: ESLint, Prettier, 80 birim testi ve web build geçti; web tarafındaki 60 tarayıcı senaryosu etkilenmedi. Aynı imzalı Android release build üretildi ve Android 36 ARM64 emülatöründe (fiziksel cihaz değil) denendi: 1.3.0 üzerine güncelleme kayıtları ve rol tercihini korudu; yeni ana ekran, kategori ekranı, hedef planında adım tamamlama, hesap menüsü ve sistem geri tuşu çalıştı; native hata kaydı görülmedi. Beş rolün ana ekranları ile hedef, optik ve etüt ekranları tarayıcı önizlemesinde 390 ve 320 dp genişliklerde, açık ve koyu temada incelendi. Optik/etüt akışlarının tam dosya seçici ve Windows-1254 dosyası adımları cihazda ayrıca denenmedi.

## 1.3.0 iş akışları, klavye ve taslaklar

- Bütün metin/arama alanları ortak klavye düzenini kullanır. Sayfalarda odak ve imleç izlenir; seçim pencerelerinde ve sohbette klavyeye göre kullanılabilir alan ayarlanır. Uzun metin alanları sınırlı yükseklikte kendi içinde kayar.
- Ders programı gün/hafta seçimi, ders/sınıf filtreleri ve saat aralıklarıyla gösterilir. Öğretmen ders ayrıntısından doğru sınıf ve güne ait yoklamayı açar.
- Mesajlar konuşma listesi ve sohbet ekranına ayrıldı; yazma alanı konuşmanın altında kalır. Uzun konuşmalarda liste sanallaştırılır, önceki mesajlar istenince gösterilir.
- Video kütüphanesi ders ve izlenme durumu filtreleri, süre ve ilerleme bilgisi gösterir. İki paketli video çevrimdışı oynatılır.
- Ödev dosyası/notu, öğretmen yanıtı, mesaj, genel işlem formları ve sınıf/gün yoklaması ayrı yerel taslaklarda saklanır. Geri dönme, modal kapatma ve yeniden açılışta geri yüklenir. Taslaklar rol/çocuk/kayıt bazında ayrılır; başarılı kayıt sonrası temizlenir. Hata olursa başarılı gösterilmez.
- Başlıklarda tekrarlanan ders önekleri görüntüleme katmanında temizlendi. Rol kapsamı hesaplamasındaki iç içe atama taramaları tek geçişe indirildi. Yazarken okul verisinin tamamı klonlanmaz.

Yeni bağımlılıklar Expo 57 ile uyumlu `react-native-keyboard-controller` 1.21.9, `react-native-reanimated` 4.5.1 ve `react-native-worklets` 0.10.1; üçü de MIT lisanslıdır. Babel eklentisi Expo preset tarafından sağlanır. Native yapı Expo prebuild ile yeniden üretilebilir. Veri/snapshot biçimi ve imza korundu; eski APK kaldırılmadan güncellenebilir.

Native kontroller Android 36 ARM64 emülatöründe yapıldı; fiziksel Android cihaz testi yapılmadı. Emülatör ölçümleri telefon performansı garantisi değildir.

1.3.0 doğrulaması: ESLint, Prettier, 35 iş kuralı testi, web build, Expo web export ve aynı imzalı Android release build geçti. Beş rolün 55 sayfası açık/koyu temada açıldı (110 kontrol). Web akışlarında dosya/not/yanıt/mesaj/form/yoklama taslakları, çocuk ayrımı, filtreler, gerçek video ve yeniden açılış kontrol edildi. Android'de beş rolün metin alanları, uzun yanıt, sohbet, tam sayfa/modal düzenleri ve taslak kalıcılığı; 320 dp/%160 yazıda yanıt alanı ile sohbet alanı/Gönder düğmesi açık klavyenin üstünde ölçüldü. Native hata kaydı görülmedi.

Performans: aynı Android emülatöründe ilk Activity çizimi medyanı önce 443 ms, sonra 463 ms (üçer açılış). Bu ölçüm okul verisinin bütünüyle yüklenmesini veya gerçek telefon akıcılığını temsil etmez; genel bir hızlanma iddiası değildir. Tek geçişli rol kapsamı hesabı Node üzerinde 5.000 tekrar için 153,44 ms'den 8,70 ms'ye indi. Fiziksel telefon doğrulaması yapılmadı.

**Önceki Kampüs uygulamasını kaldırmayın.** Yeni APK aynı imzayla hazırlanmıştır; üzerine yükleyerek kayıtları ve tercihleri koruyabilirsiniz. Yerel veri biçimi değişmedi.

## Kurulum

1. `apklar/kampus-1.4.0.apk` dosyasını Android telefona aktarın.
2. Dosyayı açın. Android isterse dosyayı açtığınız uygulama için “Bu kaynaktan yüklemeye izin ver” seçeneğini etkinleştirin.
3. Kampüs'ü açıp Yönetici, Ön Büro & Satış, Öğretmen, Öğrenci veya Veli rolünü seçin.

Android 7 ve üzeri 64 bit ARM telefonlar desteklenir. Aynı APK, x86_64 emülatörlerde de çalışır. Uygulama kimliği `com.onurevis.kampus`, sürüm kodu `7`'dir. Yalnızca APK dosyaları `apklar/` klasörüne çıkar; yeni derlemelerde SHA-256 özetleri `artifacts/mobile-build/` içinde aynı sürüm adıyla üretilir.

## Kullanım

- Üst bardaki menü düğmesi rolün bütün sayfalarını kategoriler halinde açar. Menüdeki hesap seçeneklerinden rol ve açık/koyu/sistem tema değişir. Tema tercihi ayrıca ayarlardan yönetilir. Veli, çocuk profilleri arasında geçebilir.
- 3 kampüs, 24 sınıf, 240 öğrenci ve 48 öğretmenin ortak örnek verileri kullanılır. Kampüs/sınıf/öğretmen yönetimi, adaydan kayda dönüşüm, taksit/tahsilat, yoklama, ödev, quiz, soru-cevap, mesaj, randevu ve analizler aynı yerel kayıtlara dayanır.
- İki ders videosu APK'ya dahildir; internet kapalıyken oynar, izleme ilerlemesi kaydedilir.
- Dekont, sözleşme, taksit planı, ödev, değerlendirme ve çalışma kâğıdı kendi PDF şablonlarıyla üretilir. Belgeyi telefonda seçtiğiniz klasöre kaydedebilir, Android paylaşım ekranını veya yazdırma hizmetini kullanabilirsiniz. Klasör seçiminde Android'in izin verdiği bir alt klasör seçin; bazı cihazlarda İndirilenler kök dizinine izin verilmez.
- Öğrenci ödev teslimi PDF, JPG veya PNG; diğer dosya formları ayrıca DOCX kabul eder. Sınır 10 MB'dir. Seçilen dosya uygulamanın kendi deposuna kopyalanır.
- Form değişiklikleri, rol, çocuk ve tema cihazda saklanır. Uygulamayı kapatıp açmak verileri silmez. Uygulamayı kaldırmak veya Android ayarlarından verilerini temizlemek yerel kayıtları siler.
- Yönetici ayarlarından modüller açılıp kapanır. Demo sıfırlama onay gerektirir.

Ödemeler ve bildirimler demo işlemleridir. Gerçek banka tahsilatı veya SMS/e-posta gönderimi yapılmaz. Her cihaz bağımsızdır; web ve telefon arasında veri senkronizasyonu yoktur.

## Geliştirme ve APK üretimi

```bash
pnpm install --frozen-lockfile
pnpm mobile
pnpm build:apk
```

Node.js 24, pnpm 11, JDK 21 ve Android SDK 36 kullanılır. `ANDROID_HOME` ve `JAVA_HOME` shell üzerinden veya kökteki git dışı `.env.android` dosyasında tanımlanabilir; örnekler `apps/mobile/.env.example` içindedir.

`pnpm build:apk`, lint/format/birim testleri/web build kontrolünden sonra Expo prebuild ve Gradle release derlemesini çalıştırır. Android kaynakları `apps/mobile/android/` altında yeniden üretilebilir; native ayarlar `app.json` ve `plugins/` üzerinden yönetilir. Ortak saf iş kuralları `packages/school-core` paketindedir.

İmzalama anahtarı ve parolası kaynak deposunun dışında `~/.config/kampus/android-release/` içinde, yalnızca kullanıcıya açık izinlerle tutulur. Bu dizini güvenli biçimde yedekleyin; parolayı veya anahtarı repoya eklemeyin. Gelecek güncellemelerde aynı anahtar ve uygulama kimliği kullanılmalı, `app.json` içindeki sürüm/sürüm kodu artırılmalıdır. APK'yı mevcut uygulamanın üzerine kurmak verileri korur.

## API modu (geliştirme)

Varsayılan derleme çevrimdışı demodur. `EXPO_PUBLIC_API_URL` verilince uygulama gerçek API'ye bağlanır; değer derlemede pakete gömülür ve yalnız API kök adresidir (sır yazılmaz). Örnek: `apps/mobile/.env.example`; yerel değer `apps/mobile/.env.local` dosyasına yazılır (git dışı).

```bash
docker compose up -d && pnpm --filter @kampus/api db:migrate && pnpm --filter @kampus/api db:seed
pnpm dev:api                                         # apps/api/.env: PORT, CORS_ORIGINS
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm mobile --clear
EXPO_PUBLIC_API_URL=https://api.ornek.test pnpm --filter @kampus/mobile export:web --clear   # export üretim derlemesidir: yalnız https
```

- Mod değiştirirken Metro önbelleği `--clear` ile temizlenir; yoksa önceki moddaki değer pakette kalabilir.
- Adres yoksa demo, geçerli köküyse API modu açılır; üretim derlemesinde (`__DEV__` kapalı, `export:web`, APK) yalnız `https` kabul edilir, `http` (127.0.0.1, 10.0.2.2, LAN) yalnız geliştirmede geçerlidir. Kullanıcı bilgisi, sorgu veya parça içeren ya da geçersiz portlu adreste demo sessizce açılmaz; "Uygulama yapılandırması geçersiz" ekranı gösterilir.
- Telefonda giriş Better Auth Expo istemcisiyle yapılır: oturum çerezi yalnız `expo-secure-store`'da (Android Keystore) tutulur, istekler `Cookie` başlığıyla gider. AsyncStorage'a yalnız tema tercihi yazılır; seçili çocuk ve liste durumu bellekte kalır, oturum veya kurum değişince silinir. Web derlemesinde oturum tarayıcının HttpOnly çerezindedir; web kökeni API `CORS_ORIGINS` listesinde olmalıdır.
- API güvenilir kökenleri: uygulama şeması `kampus://` her ortamda (`TRUSTED_ORIGINS`), Expo Go `exp://` yalnız geliştirme/testte. Üretim API'si `exp://` kökenli girişi 403 ile reddeder; Expo Go ile yalnız geliştirme API'sine bağlanılır. Fiziksel cihazda `127.0.0.1` yerine bilgisayarın ağ adresi kullanılır.
- API modunda açık ekranlar: öğretmen Sınıflarım, veli Akademik Takip (çocuk seçici + notlar); Duyurular (beş rol, okuma ve okundu işareti) ve Mesajlar (öğretmen, öğrenci, veli: yazışma listesi, imleçli akış, yeni yazışma, gönderme). Kapalı modüllerin kartları gizlenir. Duyuru yayını ve yönetici gerekçeli mesaj erişimi yalnız web'dedir. Avatar menüsünde kurum değiştirme, tema ve çıkış bulunur. Diğer rollerin ana ekranı "hazırlanıyor" bilgisini gösterir; o ekranlar şimdilik demo modundadır.
- Hatalar Türkçedir: yanlış parola "E-posta veya parola hatalı.", hız sınırında bekleme süresi, bağlantı yokken "Sunucuya ulaşılamadı…", kullanıcı çıkmadan kapanan oturumda "Oturumunuzun süresi doldu. Yeniden giriş yapın.". Teknik ayrıntı yalnız yerel loga yazılır.
- APK'da API modu henüz doğrulanmadı (Android araç zinciri olmadan yalnız `export:web` ve birim testleri).

## Güncel teslim ve kaynak haritası

Güncel APK: `apklar/kampus-1.4.0.apk` (65.689.445 bayt). SHA-256:

```text
a5c4d8eab035581112111ac13b8b6d8c46daa3f4b8950f1e4dd9d3cbd2c8cf14
```

İmzalama sertifikasının SHA-256 özeti:

```text
1b4f914f33f85bafe45f48296c966c07c356625dae287a2b0e3980b635b89e40
```

- `src/AppRoot.tsx`: üst bar, kategori menüsü ve gezinme.
- `src/screens/RoleHome.tsx`, `SchoolLists.tsx`, `SchoolDetails.tsx`, `Attendance.tsx`: öğrenci/veli/öğretmen ana ekranları, listeler, teslim/yanıt ve yoklama.
- `src/screens/Timetable.tsx`, `VideoLibrary.tsx`, `Conversations.tsx`: ders programı, video kütüphanesi ve mesajlar.
- `src/ui/SchoolLayout.tsx`, `components.tsx`, `KeyboardLayout.tsx`: ortak bölüm/liste, alanlar, seçim pencereleri ve klavye düzeni.
- `src/store/`: cihaz kalıcılığı, rol/tema ve taslaklar.

Yollar `apps/mobile/` dizinine göredir. Proje TypeScript kullanır; tip denetimi `pnpm --filter @kampus/mobile typecheck` ile yapılır. Eski APK'lar, kaynak yedeği kopyaları ve geçici test raporları temizlik kapsamında kaldırılmıştır. Güncel teslim, uygulama kaynakları ve yeniden derleme araçları korunur.
