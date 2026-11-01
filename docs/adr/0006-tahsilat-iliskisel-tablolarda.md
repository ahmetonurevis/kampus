# ADR 0006 · Tahsilat ilişkisel tablolarda, nakit kurum ayarıyla

- Durum: Kabul edildi (2026-11-01; proje sahibinin kararı)
- Ayrıntılandırdığı: ADR 0001 karar 6 (kademeli normalleştirme), veritabani.md §4

## Bağlam

Tahsilat bugün taksit kaydının `paidAt` ve `method` alanlarıdır (`records`, `invoices`). DOM-FIN-030…033 ayrı tahsilat kaydı, kısmi ödeme, mahsup, kurum içinde benzersiz işlem referansı, ters kayıt ve ardışık dekont numarası ister. Benzersizlik ve toplam sorgusu veritabani.md §4 ölçüt 2 ve 3'tür.

ÖÖKY md. 55/3'e dayanan DOM-FIN-032 öğrenim ücretinde nakdi kapatıyor, ek hizmetlerde de doğrulanana kadar kapalı tutuyordu. IST-106 ise nakdi yöntem sayıyordu. Proje sahibi nakdin yapılmasını, kurum ayarından açılıp kapatılmasını istedi.

## Kararlar

1. **Tahsilat iki tabloda.** `payments` (tutar, yöntem, referans, ödeme anı, dekont numarası, iptal bilgisi) ve `payment_allocations` (tahsilatın taksitlere dağılımı). Kimlik `uuid`, yabancı anahtar `(institution_id, …)` bileşiktir.
2. **Taksit ve sözleşme `records`'ta kalır.** Taşımak Vue ve mobil demo için bağdaştırıcı gerektirir; demo kalıcılığı silinince ayrı ADR ile değerlendirilir. `invoice_id` bu yüzden yabancı anahtar değildir (ADR 0004 karar 4'teki `records` kimlikleri gibi); aynı kurum ve öğrenci şartını core ve servis sağlar.
3. **`paidAt` geçiş önbelleğidir.** Taksit tam kapandığında `paidAt` ve `method` tahsilatla aynı transaction'da yazılır, iptalde temizlenir. Liste, panel ve belge kodu bu alanı okumaya devam eder. Kısmi ödeme tutarı saklanmaz, dağılımlardan hesaplanır.
4. **Mahsup.** Tahsilat önce varsa seçilen taksite, sonra en eski vadeye dağılır. Açık taksitleri aşan kısım iade alacağıdır, dağıtılmaz. Hiç açık taksit yoksa tahsilat reddedilir.
5. **Düzeltme.** Tahsilat silinmez, tutarı değişmez. İptal gerekçeyle aynı satıra yazılır, dağılımları hesaptan düşer. Referans benzersizliği yalnız iptal edilmemiş satırlara uygulanır; doğru tahsilat aynı banka referansıyla yeniden girilebilir (DOM-FIN-033).
6. **Dekont numarası.** Kurum ve yıl (Europe/Istanbul, kayıt anı) içinde kurum kilidi altında ardışık üretilir, benzersiz indeksle korunur.
7. **Nakit kurum ayarıdır.** `payment_settings.cash_payments_enabled` varsayılan kapalıdır (satır yoksa kapalı, sürüm 1); yalnız yönetici değiştirir, değişiklik denetim kaydına yazılır. Kapalıyken nakit tahsilat 422 `cash_payment_disabled` alır. Ayar öğrenim ücreti ile ek hizmeti ayırmaz: tarife gelene kadar tahsilatta kalem bilgisi yoktur.
8. **Tarife sürümlüdür.** `fee_tariffs` eğitim yılı başına sürüm tutar; kalemler core şemasıyla doğrulanan `items` jsonb'dir. Yılda tek açık taslak ve tek yayındaki sürüm kısmi benzersiz indekslerle korunur. Yayımlanan satır değişmez, yeni sürüm önceki sürümü `superseded` yapar; KDV oranı kalemde tarihli tutulduğu için geçmiş kayıtlar eski oranla kalır (IST-104).

9. **Kesin kayıt tarifeye bağlıdır, kimlik ayrı tablodadır.** Tutar girdi değildir; eğitim yılının yayımlanmış tarifesinden, ilan ücreti üzerinden hesaplanan indirimlerle üretilir ve sözleşmeye karar anının kopyası olarak yazılır (`tariffId`, `grossCents`, `discounts`, `netCents`). T.C. kimlik no ve doğum tarihi `student_identities` tablosundadır: `records.data`'ya girmediği için genel okuma ve kapsam kodu bu alanlara ulaşmaz, arşivlenmemiş kimlik tekilliği benzersiz indeksle korunur (yenilemede öğrenci kaydı aynı kaldığı için yıla bağlanmaz; pasif kaydın kimliği yeniden kullanılır). Yenileme işlemi şimdilik tarifeye bağlı değildir.

10. **Ayrılış ve iade tek kayıttır.** `student_withdrawals` ayrılışı, hesap dökümünü (`breakdown`, karar anının kopyası) ve iade ödemesini tutar; sözleşme başına tek satır. Öğretim takvimi kaynağı olmadığı için görülen ve toplam birim yönetici tarafından girilir. Kesinti oranı `REFUND_DEDUCTION_BASIS_POINTS` sabitidir ve dökümde saklanır; kurum profili gelince parametre olur. Yuvarlama ödeyici lehinedir. Ayrılış ve iade ödemesi taze oturum ister. Açık taksitler arşivlenir, kısmi ödeme hesapta kalır. Öğrenim, ek hizmet ve dağıtılmamış tahsilat tek bakiyede netleşir, iade ve borç birlikte oluşmaz; borç kalırsa tek taksit açılır. Ayrılış kaydı olan öğrencinin tahsilatı iptal edilemez, çünkü iade hesabı ona dayanır.

11. **Muhasebe aktarımı dönem satırlarıdır.** Tahsilat ödeme gününde artı, iptal gününde eksi satırdır; böylece önceki dönemde aktarılmış tahsilatın iptali sonraki dönemi düzeltir. Yalnız ödenmiş iade aktarılır, taksit vade gününe göre listelenir. Toplam ve dosya aynı satırlardan üretilir. Biçim CSV'dir (`;`, BOM, ondalık virgül); belirli bir muhasebe programının şablonu pilotla netleşince eklenir.

## Sonuçlar

- Nakdi açmanın ÖÖKY md. 55/3 açısından sorumluluğu kuruma geçer; yasal uygunluk **doğrulanmalı**, pilot öncesi hukukçuya sorulacak.
- İade hesabının tabanı (net ücret), gün sayımı ve ek hizmet iadesi mevzuatta açık değildir; **doğrulanmalı**, pilot öncesi hukukçuya sorulacak.
- Tahsilatın bildirilmiş banka hesabına bağlanması (DOM-FIN-032) kurum hesap ayarı gelene kadar yapılmaz.
- `POST /invoices/:id/pay` React ekranı yeni uca geçene kadar kalır; taksitin kalan tutarını referanssız tahsilat olarak yazar.

## Alternatifler

- **Hepsi `records`'ta:** referans tekilliği yalnız uygulama kilidine kalır, dönem toplamı JSONB üzerinden hesaplanır. Reddedildi.
- **Taksit ve sözleşmeyi de taşımak:** yabancı anahtar tam olur ama demo uyumu ve veri taşıma kapsamı büyütür. Ertelendi.
- **Nakdi tamamen kapatmak:** DOM-FIN-032'nin önceki hâliydi; proje sahibi kurum ayarını seçti.
