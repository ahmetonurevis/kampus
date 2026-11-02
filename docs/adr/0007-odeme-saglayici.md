# ADR 0007 · Çevrim içi ödeme sağlayıcısı

- Durum: Taslak (2026-11-02); sağlayıcı seçimi proje sahiplerinin kararıdır
- Ayrıntılandırdığı: ADR 0006 (tahsilat tabloları), DOM-FIN-030…033, IST-133
- Kapatacağı: `TODO(payment-provider)` (`packages/school-core/src/lib/authorize.ts`, `apps/api/src/routes/payments.ts`)

## Bağlam

Veli ve kursiyer bugün çevrim içi ödeme yapamaz: `invoice.payOnline` eylemi tanımlıdır ama sağlayıcı onayı gerektirdiği için hiçbir işlem çağırmaz. IST-133 en az bir lisanslı sağlayıcıyla 3D Secure tahsilat ister. Kabul ölçütü: sağlayıcı bildirimi imza doğrulamasıyla işlenir, iade sağlayıcı üzerinden başlatılır. Kart verisi Kampüs'te tutulmaz, Kampüs para tutmaz (ister listesi "Kartla tahsilat").

Platform çok kurumludur ve DOM-FIN-032 öğrenim ücretinin kurum adına bildirilmiş banka hesabına geçmesini ister. Bu yüzden asıl soru marka değil, paranın hangi hesaba ulaştığıdır.

## Karar önerisi

Aşağıdakiler sağlayıcıdan bağımsızdır; sağlayıcı seçilmeden de geçerlidir.

1. **Barındırılan ödeme sayfası.** Kart bilgisi sağlayıcının sayfasında ya da iframe'inde girilir; API ve web kart verisi görmez, loglamaz. PCI kapsamı böylece en dar kalır.
2. **Sağlayıcı arayüzün arkasındadır.** `apps/api/src/services/payment-providers/` altında tek arayüz: ödeme başlat, bildirimi doğrula, iade başlat. Yeni sağlayıcı yeni sürücüdür; iş kuralı sağlayıcıyı bilmez.
3. **Kurum başına hesap.** Her kurum kendi üye iş yeri bilgisini girer ve para doğrudan kurumun hesabına geçer (DOM-FIN-032). Anahtarlar `records.data`'ya yazılmaz; ayrı tablo ve şifreli kolon, okuması denetim kaydında. Sırlar loglanmaz.
4. **Tahsilatı yalnız bildirim yazar.** Tarayıcı dönüşü tahsilat açmaz, yalnız durum gösterir. İmzası doğrulanan sağlayıcı bildirimi `planPayment` ile `payments`'a yazılır; yöntem `Kredi kartı`, referans sağlayıcı işlem numarasıdır.
5. **Bildirim idempotenttir.** Aynı bildirim ikinci tahsilat açmaz (mevcut `payments_reference_key`). Süre aşımı ve kayıp bildirim için sağlayıcıdan durum sorgulayan `pg-boss` işi çalışır.
6. **Uyuşmazlık sessiz çözülmez.** Tutar uyuşmazlığı ya da kapalı taksite ödeme, yöneticinin göreceği bir kayda düşer; otomatik mahsup, ADR 0006 karar 4'teki kuraldır.
7. **İade sağlayıcıdan başlatılır.** İade sonucu bildirimle yazılır; `student_withdrawals` kaydıyla bağı DOM-FIN-041'e uyar.
8. **Modül ayarıdır.** Kapalı kurumda ödeme düğmesi ve uçlar kapalıdır; bildirim ucu yalnız imza ile açıktır, oturum istemez ve hız sınırı taşır.

## Sağlayıcı seçimi için ölçütler

Rakamlar ve koşullar sağlayıcılardan yazılı alınmadan bu belgeye yazılmaz.

| Ölçüt        | Soru                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Lisans       | BDDK/TCMB lisansı geçerli mi?                                                                      |
| Çok kurum    | Her kurum kendi üye iş yeri olabiliyor mu, alt üye iş yeri modeli var mı?                          |
| Paranın yolu | Tahsilat doğrudan kurumun bildirilmiş hesabına geçiyor mu (DOM-FIN-032)?                           |
| Teknik       | Barındırılan sayfa, 3D Secure, imzalı bildirim, durum sorgulama, kısmi iade ve test ortamı var mı? |
| Maliyet      | Komisyon, valör, sabit ücret ve taksit vade farkını kim üstleniyor?                                |
| Taksit       | Kredi kartına taksit, sözleşmedeki taksit planıyla nasıl eşleşiyor?                                |

Değerlendirilecek adaylar: banka sanal POS'ları ve lisanslı ödeme kuruluşları (ör. iyzico, PayTR, Param). Bu liste öneri değildir.

## Açık sorular

- Kampüs'ün ödeme hizmeti lisansı gerektirmediği varsayımı **doğrulanmalı** (hukuk).
- Kart komisyonunu veliye yansıtmak ÖÖKY ilan kurallarıyla uyumlu mu? **doğrulanmalı** (hukuk ve mali müşavir).
- Kartla ödenen taksit için dekont yeterli mi, e-arşiv zorunluluğu nasıl karşılanır? **doğrulanmalı** (mali müşavir).
- Velayeti olmayan ödeyici veli ödeme başlatabilir mi (DOM-ILT-074)? Ürün kararı.

## Sonuçlar

- Karar kabul edilmeden çevrim içi ödeme kodu yazılmaz; `invoice.payOnline` kapalı kalır.
- Karar kabul edilince IST-133 ayrı görevlere bölünür: sürücü arayüzü, bildirim ucu, kurum ayarı, veli ekranı, iade.
