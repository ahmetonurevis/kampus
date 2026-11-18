# ADR 0011 · Bordroyu Kampüs hesaplar

- Durum: Kabul edildi (kullanıcı kararı, 18 Kasım 2026; Onur)
- Hazırlayan: Onur (ON-193); uygulama ON-198
- İster: IST-142 (sınır), IST-143 (resmî sisteme otomatik yazma yok ilkesi)
- Değiştirdiği: ON-193 sorusu açıkken kural belgelerine yazılan "Kampüs bordro hesaplamaz (ON-193)" varsayımı (`DOM-FIN-105`, `DOM-FIN-107`, `DOM-FIN-108`, öneri K-336)

## Bağlam

ON-193 şunu soruyordu: Kampüs bordroyu (brütten nete ön hesap) kendisi mi yapar, yoksa kurumun bordro programına ya da mali müşavirine yalnız girdi mi üretir? Karar verilene kadar personel ve bordro işleri "Kampüs hesaplamaz, girdi üretir" varsayımıyla yazıldı. Bugün entegrasyonda şunlar var:

| Görev  | Kural         | Ne yapar                                                                                                                                                                             |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ON-194 | `DOM-FIN-099` | Yürürlük tarihli ücret tanımı: aylık brüt/net, saatlik ve ders saati ana ücreti, ek ders ve nöbet ücreti, nakdi/ayni yan haklar.                                                     |
| ON-197 | `DOM-FIN-100` | Yürürlük tarihli bordro parametre setleri: asgari ücret, gelir vergisi dilimleri, SGK ve işsizlik payları, işveren indirimi, taban/tavan, damga vergisi, iki asgari ücret istisnası. |
| ON-199 | `DOM-FIN-101` | Avans taksitleri, icra ve nafaka sırası, BES; aylık kesinti listesi saf hesaptır ve net ücreti girdi olarak bekler (K-315).                                                          |
| ON-200 | `DOM-FIN-108` | Ay onayı ve dönem kilidi; kilitli aya fark düzeltme kaydıyla sonraki kilitsiz aya aktarılır.                                                                                         |
| ON-202 | `DOM-FIN-105` | Bordro girdi dosyası (CSV, sütun eşleme şablonu). Hesap yapmaz: kısmi ayda, saatlik ücrette ve net ücrette tutar boş kalır.                                                          |
| ON-203 | `DOM-FIN-107` | SGK bildirge hazırlık listesi: prim günü, eksik gün, matrah tahmini; resmî gönderim yok.                                                                                             |
| ON-185 | `DOM-FIN-110` | Personel sağlık raporu günleri (eksik gün ve rapor kaynağı).                                                                                                                         |
| ON-181 | `DOM-FIN-109` | İzin türleri ve yıllık izin hak edişi; ücretli/ücretsiz izin işareti.                                                                                                                |
| ON-204 | `DOM-FIN-104` | Maliyet merkezine göre **tahmini** personel maliyeti; net tanımlı ücret brüte çevrilmediği için tahmine girmez (K-333).                                                              |

Bu parçalar bordronun bütün girdilerini topluyor ama sonucu üretmiyor. Girdi dosyası tek başına yetmiyor: ay içinde giren ya da çıkan personelde, saatlik ve ders saati ücretinde ve net anlaşmalı ücrette tutar boş kalıyor (M-39, M-55). Kesinti listesi net ücreti bilmeden icra tavanını doğru kuramıyor (M-42). Personel maliyeti gerçekleşen değil tahmin. Kurum aynı veriyi hem Kampüs'e hem bordro programına giriyor. Proje amacı da üçüncü taraf bağımlılığını azaltmak.

### IST-142 sınırı

IST-142 (Won't): "Genel muhasebe ve defter — muhasebe programlarının işi; Kampüs dışa aktarır." Bu karar o sınırı değiştirmez. Bordro hesabı ile defter ayrı işlerdir:

- **Bordro hesabı** işverenin ücret işidir: brütten nete, kesintiler, işveren maliyeti, ücret hesap pusulasının içeriği (4857 sayılı İş Kanunu md. 32, 37). Girdileri zaten Kampüs'tedir.
- **Defter** vergi usulü kaydıdır: bordronun tahakkuku, ödenecek vergi ve SGK primleri, banka ödemesi yevmiye ve büyük deftere yazılır. Bu muhasebe programının ve mali müşavirin işidir; Kampüs tutmaz.

Kampüs bordroyu hesaplar, sonucu muhasebeye **dışa aktarılabilir veri** olarak verir; yevmiye kaydı, hesap planı ve mizan tutmaz.

## Kararlar

1. **Kampüs aylık bordroyu hesaplar (ON-198).** Brütten nete ve netten brüte çevirir. Net anlaşmalı ücret (M-39) brüte çevrilerek hesaplanır; saatlik ve ders saati ücreti çalışılan saatle aylık brüte çevrilir.
2. **Hesap kalemleri.**
   - SGK işçi ve işveren payı (işveren indirimi parametredeki gibi), işsizlik sigortası işçi ve işveren payı; prime esas kazanç taban ve tavanı.
   - Gelir vergisi: yıl içi **kümülatif matrah** ile dilimlere göre.
   - Asgari ücret istisnası: gelir vergisi ve damga vergisi istisnası ayrı ayrı (GVK md. 23/18, DVK).
   - Damga vergisi.
   - Kesintiler: avans, icra, nafaka ve BES (`DOM-FIN-101`, ON-199); icra tavanı hesaplanan net ücretten kurulur.
   - Ek ders ve nöbet: saat × yürürlükteki ek ders ücreti; ders saati özeti gelince (ON-195, OG-116) saat oradan gelir.
   - Eksik gün: SGK eksik gün kayıtları (`DOM-FIN-107`), sağlık raporu (`DOM-FIN-110`) ve ücretsiz izin (`DOM-FIN-109`); kısmi ay ve ay içi giriş/çıkış.
   - Kilitli aydan aktarılan düzeltme farkları (`DOM-FIN-108`).
3. **Oran ve sınır yalnız bordro parametrelerinden okunur** (`DOM-FIN-100`). Hesap kodunda yasal oran ya da tutar sabiti yoktur. Dönemin geçerli seti kullanılır; set güncel değilse (`stale`) bordro uyarı taşır. Parametrede karşılığı olmayan durum (engelli indirimi, sektörel ve bölgesel teşvik, emekli çalışanın SGDP'si gibi) tahmin edilmez: o personelin bordrosu uyarıyla durur ve elle tamamlanmak üzere işaretlenir.
4. **Hesap core'da tek yerdedir** (`packages/school-core`), saf fonksiyondur; API, web ve SGK hazırlık listesi aynı sonucu okur. Tutarlar kuruş tamsayıdır, yuvarlama kuralı tek fonksiyondadır.
5. **Onaylı dönem kilitlenir** (ON-200). Ay onayı hesaplanan bordroyu ve girdilerini birlikte dondurur; onaylı bordro değişmez, fark düzeltme kaydıyla sonraki kilitsiz aya aktarılır.
6. **Resmî beyan ve bildirge verilmez** (IST-143 ilkesi). Muhtasar ve Prim Hizmet Beyannamesi (GİB) ve SGK bildirimleri Kampüs'ten gönderilmez; Kampüs hazır liste üretir (SGK hazırlık listesi ON-203, bordro dökümü). Bordro pusulası (personel self-servisi, PDF) ayrı görevdir (ON-201); bu ADR yalnız hesabı kapsar.
7. **Muhasebe kaydı yok** (IST-142). Bordro tahakkuku Kampüs'te deftere yazılmaz; muhasebe programına bordro aktarımı ayrı bir dışa aktarım görevidir (muhasebe dışa aktarımı IST-111'in yanında).
8. **Mali müşavir doğrulaması zorunludur.**
   - Platform düzeyinde: hesap kuralları ve platform parametre değerleri pilottan önce mali müşavire doğrulatılır (M-40, M-41 ve ON-198'in açacağı sorular); doğrulanana kadar kural belgelerindeki **doğrulanmalı** etiketi kalkmaz.
   - Kurum düzeyinde: hesaplanan her tutar ekranda, dökümde ve dosyada "doğrulanmalı" uyarısıyla sunulur. Resmî beyan ve ödeme öncesinde kurumun mali müşaviri kontrol eder; sorumluluk işverendedir.
9. **Bordro aktarımı kalır** (ON-202, `DOM-FIN-105`). Bordroyu kendi programında ya da mali müşavirinde hesaplatmayı sürdüren kurum girdi dosyasını kullanmaya devam eder. İki yol aynı girdileri okur; kurum geçiş döneminde ikisini birlikte çalıştırıp sonuçları karşılaştırabilir.

## Sonuçlar

- ON-198 "ön hesap" değil, onaylanıp kilitlenen bordro hesabıdır. Kesinti listesi (K-315) net ücreti hesaptan alır; SGK hazırlık listesinin matrahı ve personel maliyeti (ON-204) ileride tahmin yerine hesaplanan bordrodan beslenebilir.
- Kural belgelerindeki "Kampüs bordro hesaplamaz (ON-193)" cümleleri bu ADR'ye göre güncellenir (`DOM-FIN-105`, `DOM-FIN-107`, `DOM-FIN-108`, K-336). Kod yorumları, OpenAPI açıklamaları ve ekran metinlerindeki aynı cümle ON-198 ile birlikte değişir.
- Bordro parametreleri artık yalnız bilgi değil, ödenen ücretin kaynağıdır; parametre setine eksik kalemler (M-41 soru 3) eklenecektir.
- Kampüs yeni bir sorumluluk alanına girer: hesap hatası personelin ücretini ve işverenin beyanını etkiler.

### Riskler

- **Yasal değişiklik takibi.** Asgari ücret yılda bir ya da iki kez, dilimler ve damga oranı her yıl, SGK tavanı ve teşvikler mevzuatla değişir. Yeni değer yürürlüğe girmeden platform seti eklenmezse hesap eski setle yapılır (`stale` uyarısı). Azaltma: her yıl aralık ve haziran sonunda parametre gözden geçirmesi; kurum kopyası (K-309) platform sürümü gecikirse köprüdür.
- **Sürüm başına parametre güncellemesi.** Platform setleri kodda durur ve sürümle gelir (K-308); bir değer değişikliği sürüm ve yayın ister. Geçmiş dönemler eski setle hesaplanmaya devam eder, onaylı ay kilitli kalır; yeni set yalnız yürürlük gününden sonrasını etkiler.
- **Hata sorumluluğu.** Kampüs'ün sonucu resmî beyanın yerine geçmez; "doğrulanmalı" uyarısı ve mali müşavir kontrolü kurumun sorumluluğunu belirginleştirir. Sözleşme ve kullanım şartlarındaki sorumluluk sınırı hukukçuya sorulur (takip).
- **Test yükü.** Hesap, mali müşavirce onaylanmış örnek bordrolarla (tam ay, kısmi ay, asgari ücretli, dilim atlayan, netten brüte, icralı) birim testinde sabitlenir; parametre değişikliği bu örnekleri bozmadan girmelidir.

## Alternatifler

- **Yalnız girdi üretmek** (ON-193'e kadarki varsayım). Reddedildi: kısmi ay, saatlik ve net ücret tutarları boş kalır; kesinti tabanı ve personel maliyeti tahminde kalır; kurum veriyi iki yere girer ve bordro programı bağımlılığı sürer. Girdi dosyası yine de karar 9 ile kalır.
- **Bilgi amaçlı ön hesap** (sonuç onaylanmaz, kilitlenmez, yalnız karşılaştırma için). Reddedildi: kurum yine dış programın sonucunu esas alır, bağımlılık azalmaz; kullanıcı hesabın onaylanan bordro olmasını seçti. "Doğrulanmalı" uyarısı bu seçeneğin güvencesini korur.
- **Dış bordro servisinin API'si.** Reddedildi: herkese açık, sözleşmesi ve sürekliliği belli bir bordro hesap API'si bilinmiyor; ücret ve kimlik verisinin üçüncü tarafa aktarımı ek KVKK yükü (veri işleyen sözleşmesi, olası yurt dışı aktarım) ve kurum başına maliyet getirir; proje amacı dış bağımlılığı azaltmaktır. Bir kurumun kullandığı servis ileride açık API ve webhook (IST-140) ya da girdi dosyası (karar 9) üzerinden bağlanabilir.
