# Kampüs Android

React Native ve Expo. Beş rol, mevcut modüller, çevrimdışı ortak örnek veri ve AsyncStorage kalıcılığı. Gerçek ödeme, uzaktan bildirim ve web–telefon senkronizasyonu yoktur.

- TypeScript: mobil kodun tamamı TypeScript'tir (`strict`, `allowJs` kapalı; `pnpm --filter @kampus/mobile typecheck`): `src/model`, `src/lib`, `src/store`, `src/ui`, `src/screens`, `AppRoot`, `App`, `index`. Yeni `.js`/`.jsx` dosyası eklenmez. Gezinme parametre tipleri `src/route-types.ts` içindedir (`RootStackParamList`, `ScreenProps<'Ad'>`); yüklü veri ve rol gerektiren ekranlar `useActiveSchool()` kullanır (veri ve rol dolu gelir).
- Klasör haritası, kategori/gezinme uygulaması (`ModuleHub`, `CategoryScreen`), sürüm bazlı uygulama notları ve derleme ayrıntısı `docs/mobil/uygulama-notlari.md` içindedir.
- Renk, menü ve gezinme kuralları (safir/turuncu, sayfa zemini `#EFF3FB`, hamburger menü, hesap sayfaları, hızlı erişim/alt navigasyon yok, öğrenci ödemeleri telefonda yok) `.claude/rules/tasarim.md` içindedir. Mobil: `availablePages` telefonda gösterilmeyen sayfaları (öğrenci `odemelerim`) eler, web menüsü değişmez; renk geçişi ve renkli dekoratif kenar çizgisi yoktur; Android sistem geri tuşu, güvenli ekran alanları, yazı ölçeği ve klavye çakışmaları ele alınır.
- APK Expo Go veya geliştirme sunucusu gerektirmeden açılmalıdır. İmzalama anahtarı kaynak dışında saklanır. `pnpm build:apk` kalite kontrolleri ve yerel release derlemesi yapar; APK'lar proje kökündeki `apklar/` klasöründe bulunur ve bu klasör yalnızca APK içerir. Teslim özeti `docs/mobile-release.md`.
- Hatalar `src/lib/error-log.ts` (`recordError`) ile yapılandırılmış günlüğe yazılır; kullanıcıya Türkçe ayrıntısız mesaj (`lib/error-message.ts`) gider.

## Mimari: demo ve API modu

- Mod açılışta `EXPO_PUBLIC_API_URL` ile seçilir (`src/api/config.ts`, `appMode`): boşsa çevrimdışı demo (`store/SchoolProvider.tsx`, AsyncStorage); `api` ise `AppRoot` tembel olarak `src/api/ApiApp.tsx` yükler; `invalid` ise yapılandırma hatası gösterilir. Demo, API geçişi bitince silinir. Üretimde (`__DEV__` kapalı) adres yalnız `https` olabilir; geliştirmede `http://127.0.0.1`, `10.0.2.2` ve LAN adresleri çalışır.
- API oturumu: Better Auth Expo istemcisi `expo-secure-store` ile (`src/api/clients.ts`); `src/api/auth.tsx` oturum durumunu `/me` sorgusundan okur. Sorgu katmanı `@kampus/react-shared/KampusProvider.tsx` ile kurulur (TanStack Query, `packages/api-client`).
- `KampusProvider` önbelleği `userId` değişince veya giriş ekranına düşüşte (401 dahil) temizler; başka kullanıcının verisi önbellekten sızmaz.
- Ekranlar kuralları core'dan tüketir: menü ve kategori `school-core/modules/full-navigation.ts` (`src/api/pages.ts`, `model/hub.ts`), iş akışı liste/form/detay `lib/workflow-presentation.ts` (`WorkflowScreen`, `ui/WorkflowFormSheet`), State tipi `school-core/data/seed.ts`. Ekran iş kuralı yazmaz.
- Ekran kaydı (`api/screen-registry.ts`, web `page-registry.tsx` eşi): her menü ekranı tek kayıttır (`screen`, `getComponent`, `pages`); menü kartı, kategori, yığın kaydı ve `ApiScreen` tipi bu listeden türer. Sahip blokları web biçimindedir (`// Oğuzhan: …` `sonu`, `// Onur: …` `sonu`); yeni kayıt bloğun sonuna eklenir. Onur'un ekran dosyası küçük harfli, kendi alan kalıbına uyan adla yazılır (`screens/finance-parent.tsx`); PascalCase ad Oğuzhan'ın alanına düşer. Ekran dosyası `export default function <Bileşen>` verir. Her kayıtlı ekran `api/registered-screen.tsx` hata sınırındadır (hata yalnız o ekranı "Ekran açılamadı" ile değiştirir, `recordError` ile loglanır). Kurallar `pages.ts` `screenRegistryIssues` ile `tests/mobile-screen-registry.test.ts`'te denetlenir. Ekran kabuktan ihtiyacını `api/shell.ts`'ten alır; sunucu verisi `@kampus/react-shared` kancalarıyla doğrudan okunur.
- Kapalı modül: `apiPages` kartı ve boş kategoriyi gizler; ekran `canOpenScreen` ile "Modül kullanıma kapalı" gösterir. Menü çekirdektedir; çevrimdışı demo `apiOnly` sayfaları düşürür.
- Yazma ve veri kuralları (ekran ayrıntıları `docs/mobil/api-ekranlari.md`):
  - Ekran yalnız sunucu yanıtıyla değişir; iyimser güncelleme yoktur. Hata form/pencere içinde Türkçe gösterilir (toast `silent`); gönderim sürerken düğme kilitlidir (çift dokunma tek istek).
  - Belirsiz hatada (ağ, 5xx, `idempotency_in_progress`) aynı gövde aynı `Idempotency-Key` ile yeniden gider; 429'da istek işlenmediği için yeni anahtar kullanılır. Başarısız kayıtta girilen değerler korunur.
  - Yazışma metni ve taslağı, bildirim listesi ve sayısı, ödev açıklaması ve dosyası, quiz cevapları, not puanı ve gerekçesi cihaza yazılmaz; yalnız bellekte durur.
  - Quiz puanı istemcide hesaplanmaz; cevap anahtarı ve soru bazında doğru/yanlış öğrenciye gelmez. Sayaç sunucu saatiyle işler, karar sunucudadır. Randevu ve yoklama "bugün"ü cihaz saatinden değil sunucudan (`/academic-years/current` `date`) alınır.
  - Duyuru/yazışma/bildirim/soru/randevu modelleri web ile `@kampus/react-shared` içinde ortaktır; davranışı mobilde değil orada değiştirin. Mesaj yalnız öğretmen/öğrenci/veli içindir (yönetici ve ön büro mesajı telefonda yok).
  - Veli ekranları salt okurdur; kapsamı sunucu uygular, ekran `studentId`/`classId` ister. Kapalı modülün sekmesi çizilmez.
  - Öğretmen yoklaması `If-Match` sınıf sürümünü pencere açılırken sabitler (`pinnedClassVersion`); yoklama geçmişi salt okurdur (geçmiş günü yalnız yönetici düzeltir, DOM-AKD-035). Not girişinde puanlar sırayla, her biri tek istekle gider; ağ/5xx belirsizliğinde kalanlar gönderilmez.
  - Soru fotoğrafı (DOM-ILT-094), quiz görevleri, soru çöz/sor yazma-konuşma ve veli/öğretmen randevusu telefonda yoktur.

## Performans ve kayıt bütünlüğü

- Kategori değişiminde ana ekran yeniden kurulmaz; kapalı menüler ve odakta olmayan ekranlar gereksiz çizilmez.
- Tarih/para biçimleyicileri yeniden kullanılır. Rol/sınıf/ders kapsamı tek geçişte hazırlanır; yazarken okul verisinin tamamı klonlanmaz.
- Taslaklar rol/çocuk/kayıt/sınıf/gün bazında ayrılır, başarılı işlemden sonra temizlenir; kalıcılık hatasında korunur ve Türkçe bildirim gösterilir.
- Android sistem geri tuşu, çevrimdışı yeniden açılış, güncellemede kayıtların korunması ve güvenli ekran alanları kontrol edilir.

## Doğrulama ve teslim

İş öncesi kapsam ve etkilenen dosyalar planlanır. Lint, format, kritik iş kuralı testleri ve web build çalıştırılır. Native değişikliklerde Android release derlemesi, güncelleme kurulumu, beş rol, açık/koyu tema, 320 dp/büyük yazı ve klavye/form akışları kontrol edilir. Fiziksel cihaz yoksa emülatör sınırı açıkça raporlanır.

Güncel sürüm ve teslim dosyası `docs/mobil/uygulama-notlari.md` ve `docs/mobile-release.md` içindedir. Mobil çalışmaları canlı web yayınını kendiliğinden değiştirmez.
