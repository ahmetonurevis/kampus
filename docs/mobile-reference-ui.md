# Kampüs mobil · Referans arayüz · 1.2.0

Dört tasarım görseli, gerçek React Native bileşenleriyle uygulandı. Expo 57.0.25, React Native 0.86.3, React 19 ve React Navigation 7 native stack korundu. Yeni bağımlılık eklenmedi. Projede TypeScript yapılandırması veya ayrı bir typecheck komutu yok; JSX, ESLint ve Expo/Metro derlemesiyle denetlenir.

## Ekranlar ve kaynakları

| Alan                                    | Kaynak                                                                    | Davranış                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Öğrenci, veli, öğretmen ana ekranları   | `apps/mobile/src/screens/RoleHome.jsx`                                    | Role göre günlük dersler, bekleyen işler, duyuru ve ödeme özeti                                               |
| Ödev listesi, soru kuyruğu, ödeme planı | `apps/mobile/src/screens/SchoolLists.jsx`                                 | Liste yanında arama; panelde ders/sınıf/durum/sıralama; sonuç sayısı ve gerektiğinde 10 kayıtlık sayfalama    |
| Ödev detayı ve teslimi                  | `apps/mobile/src/screens/SchoolDetails.jsx`                               | PDF/görsel seçimi, 10 MB sınırı, dosyasız doğrulama, dosyayı uygulama deposuna kopyalama ve teslim güncelleme |
| Soru yanıtlama                          | `apps/mobile/src/screens/SchoolDetails.jsx`                               | Öğrenci/sınıf/konu/bekleme bağlamı, boş yanıt doğrulaması, yanıtı kaydetme ve düzenleme                       |
| Yoklama                                 | `apps/mobile/src/screens/Attendance.jsx`                                  | Sınıf/tarih seçimi, mevcut/yok/mazeretli işaretleri, toplu mevcut, arama ve kayıt sonucu                      |
| Çocuk seçici ve ortak düzen             | `apps/mobile/src/ui/SchoolLayout.tsx`                                     | Deniz/Ece seçim paneli, bölüm/liste/sekme/sonuç/durum bileşenleri, tema seçimi                                |
| Menü, üst bar ve gezinme                | `apps/mobile/src/AppRoot.tsx`                                             | Kategorili düz menü, tek sayfa başlığı, rol değişince ana ekran; çocuk değişince mevcut ödeme ekranında kalma |
| Tema ve kalıcılık                       | `apps/mobile/src/store/SchoolProvider.tsx`, `apps/mobile/src/ui/theme.ts` | Açık/koyu/sistem tercihi, cihazda kalıcılık, depolama başarısızsa başarı göstermeme                           |
| Belge işlemi                            | `apps/mobile/src/ui/DocumentLink.tsx`, `apps/mobile/src/lib/files.ts`     | Ödev belgesini gerçek PDF olarak oluşturma, Android kaydetme/paylaşma/yazdırma                                |
| Ortak yoklama kuralı                    | `packages/school-core/src/lib/domain.ts`                                  | `excused` desteği, geçersiz/ileri tarihi reddetme; aynı gün kaydını güncelleme                                |

`Home.jsx`, `ModuleScreen.jsx` ve `Detail.jsx` yeni akışlara yönlendirir; kapsam dışındaki mevcut ekranlar kullanılmaya devam eder. Yönetici ve ön büro için yeni işlevsiz ekran üretilmedi. Ortak paket 1.0.2'ye yükseltildi; web tarafındaki yoklama etiketleri de “Mazeretli” durumunu tanır. Canlı web yayınına çıkılmadı.

## Tasarım kararları

- Beyaz zemin, safir `#1E3A8A`, sınırlı turuncu `#F97316`; ince ayraçlar ve 10–12 dp köşeler. Gradyan, cam, dekoratif sol çizgi, alt navigasyon ve hızlı erişim yok.
- Turuncu düğmelerde okunabilir kontrast için koyu metin kullanılır. Görsellerdeki beyaz yazı yerine yazılı erişilebilirlik kuralı önceliklendirildi.
- Bütün işlem hedefleri en az 48 dp. Uzun metin ve büyük yazıda satırlar büyür; sayfa ve seçim panelleri kaydırılır. Ana işlem kısa içerikte alta yerleşir, uzun içerikte sayfayla kayar.
- Başarı/hata bildirimi işlemlerin üstünü kapatmaz. Formlarda kalıcı satır içi sonuç; ilk açılışta yüklenme iskeleti ve dosya/kayıt işlemlerinde bekleme metni vardır.
- Ödeme planı gerçek taksitlerden hesaplanır. Görsellerdeki örnek sayılar uğruna mevcut kayıtlar değiştirilmez.

## Veriler ve güncelleme

`model/experience.ts` denklemler ödevi, deney raporu ve Deniz'in denklem sorusunu yalnızca eksik olduklarında ekler. Sabit kimlikler sayesinde yeniden açılışta veya sürüm yükseltirken teslimler/yanıtlar sıfırlanmaz. Mevcut öğrenci, sınıf, öğretmen, ücret ve geçmişler korunur. Dosyalar sunucuya yüklenmez; ödeme entegrasyonu yoktur.

Mazeretli yoklama devamsızlık sayısına eklenmez. Önceden kaydedilmiş “geç geldi” kayıtları korunur; kullanıcı mevcut/yok/mazeretli seçeneklerinden biriyle değiştirebilir.

## Kontrol kayıtları

- `pnpm lint`, `pnpm format:check`, 29 birim/iş kuralı testi, web build, Expo web export ve imzalı Android release build.
- Beş rolün 55 sayfası × açık/koyu tema: 110 sayfa açılışı; tarayıcı hatası yok.
- Dosyasız ödev ve boş yanıt doğrulaması, dosya teslimi, yanıt, tamamlanan listeleri, yeniden açılışta kalıcılık, çocuk geçişi, sistem temasının anlık değişimi ve mazeretli yoklama.
- 320/390 px dar ekran ve 740×360 yatay görünüm: arama/filtre, boş sonuç, sıfırlama, ilk/son sayfa, sonuç aralığı ve detay işlemlerine erişim.

Android 36 emülatöründe güncelleme, çevrimdışı dosya teslimi, soru yanıtı, çocuk seçimi, mazeretli yoklama, sistem teması, küçük ekran/%160 yazı ve PDF paylaşım penceresi denendi. Güncel sürümde büyük yazıda sekmeler yatay kayar ve seçim görünür alana alınır. Fiziksel cihaz testi yapılmadı. Güncel APK ve doğrulama kapsamı [Android teslim notlarında](mobile-release.md) bulunur; eski kontrol çıktıları temizlenmiştir.
