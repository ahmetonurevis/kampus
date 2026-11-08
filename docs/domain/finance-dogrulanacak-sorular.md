# Kayıt ve finans: hukukçu ve mali müşavire sorular

Bu belge Kampüs'ün kayıt ve finans kurallarında (`DOM-KAY`, `DOM-FIN`, kayıt ve ücretle ilgili `DOM-DIL` maddeleri, ADR 0006 ve ADR 0007) **doğrulanmalı** diye işaretlenmiş varsayımları tek listede toplar. Pilottan önce bir hukukçuya ve bir mali müşavire sorulacaktır (ADR 0006 "Sonuçlar").

- **Kime:** "Hukukçuya" bölümü özel öğretim, tüketici, borçlar ve kişisel veri mevzuatını bilen bir avukata; "Mali müşavire" bölümü fatura, KDV ve defter tutma konusunda mali müşavire yöneliktir. İki tarafı da ilgilendiren soru iki bölümde ayrı kimlikle yer alır ve birbirine atıf yapar.
- **Ne için:** Kampüs bu konularda bugün temkinli bir varsayımla çalışıyor. Her soru, varsayımın yanlış çıkması hâlinde sistemde neyin değişeceğini de yazar; cevap doğrudan kurala ve koda işlenir.
- **Nasıl cevaplanır:** Her sorunun "Cevap" satırına kısa bir hüküm (evet / hayır / koşullu), dayandığı mevzuat maddesi ve cevap tarihi yazılması yeterlidir. Ayrı yazışmada soru kimliği (ör. H-07) anılabilir. Cevaplanan soru "Kararlaştırılanlar" bölümüne taşınır, ilgili kuralın **doğrulanmalı** etiketi kaldırılır.

Bu belge hukuki görüş değildir. Mevzuat maddeleri kural belgelerinde geçtiği gibi anılmıştır; yeni madde eklenmemiştir. Kısaltmalar: ÖÖKY (MEB Özel Öğretim Kurumları Yönetmeliği), TMK (4721 sayılı Türk Medeni Kanunu), TBK (Türk Borçlar Kanunu), KVKK (6698 sayılı Kişisel Verilerin Korunması Kanunu), VUK (Vergi Usul Kanunu), İYS (İleti Yönetim Sistemi). Kural metinleri: [finans.md](finans.md), [kayit-ve-crm.md](kayit-ve-crm.md), [dil-okulu.md](dil-okulu.md).

## Hukukçuya

### Ücret, indirim ve tahsilat

#### H-01 · Dil okulunun ruhsat türü ücret kurallarını değiştirir mi

- **Kural:** `DOM-FIN-006`; `dil-okulu.md` mevzuat notu.
- **Soru:** Dil okulunun ruhsat türü (kişisel gelişim kursu, özel öğretim kursu ya da MEB ruhsatı olmayan ticari işletme) ücret ilanı, indirim tavanı ve ücret iadesi kurallarının uygulanmasını değiştirir mi?
- **Bugünkü varsayım:** Dil okulu MEB ruhsatlı bir kurstur; ÖÖKY md. 55/1-a, c'deki ders saati ücreti ve iade kuralları uygulanır.
- **Kodda:** Tarife yayımı ücret birimini kurum türüne göre denetler (`planTariffPublish`, `lib/fee-tariffs.ts`); iade ders saatine göre hesaplanır (`quoteWithdrawal`, `lib/withdrawals.ts`). Ruhsat türü kurum profilinde tutulmuyor.
- **Cevap değişirse:** Kurum profiline ruhsat türü ve buna bağlı mevzuat profili eklenir; ruhsatsız kurumda tarife ve iade kuralları kapatılabilir.
- **Cevap:** bekleniyor

#### H-02 · Burs ve ücretsiz okutma indirim tavanına girer mi

- **Kural:** `DOM-FIN-021`.
- **Soru:** Burs ve ücretsiz okutma, toplam indirimin ilan edilen ücretin %50'sini aşamayacağı kuralının (ÖÖKY md. 54/1-a) dışında mı tutulur?
- **Bugünkü varsayım:** Dışında tutulur; dayanak ÖÖKY md. 62/4 (burslu oranı ücretsiz oranının dışında tutulur) ve bursun yönetmelikte ayrı bölümde düzenlenmesidir.
- **Kodda:** Tavan `DISCOUNT_CAP_BASIS_POINTS` ile kesin kayıtta denetlenir (422 `discount_cap_exceeded`, `lib/enrollment.ts`); burs tavan hesabına girmez (`lib/finance-scholarships.ts`).
- **Cevap değişirse:** Burs tavana sayılır; kesin kayıttaki indirim ve burs hesabı ile sözleşme dökümü değişir.
- **Cevap:** bekleniyor

#### H-03 · Nakit tahsilat kurum ayarıyla açılabilir mi

- **Kural:** `DOM-FIN-032`; ADR 0006 karar 7.
- **Soru:** Kurumun kendi ayarıyla öğrenim ücretini nakit tahsil etmesine izin vermek, ücretin Bakanlığa bildirilmiş banka hesabına yatırılarak tahsil edilmesini isteyen ÖÖKY md. 55/3'e aykırı mı; yemek, servis gibi ek hizmetlerde nakit alınabilir mi?
- **Bugünkü varsayım:** Nakit kurum ayarıdır, varsayılan kapalıdır, yalnız yönetici açar ve açmanın sorumluluğu kurumdadır (proje sahibinin kararı).
- **Kodda:** `payment_settings.cash_payments_enabled`, `PATCH /api/v1/payment-settings`; kapalıyken 422 `cash_payment_disabled` (`lib/payments.ts`). Ayar öğrenim ücreti ile ek hizmeti ayırmaz.
- **Cevap değişirse:** Nakit ayarı kaldırılır ya da yalnız ek hizmetlerle sınırlanır; ADR 0006 karar 7'yi yeni bir ADR geçersiz kılar.
- **Cevap:** bekleniyor

#### H-04 · Gecikme faizi veya cezası sözleşmeye konabilir mi

- **Kural:** `DOM-FIN-034`.
- **Soru:** Ödenmeyen taksit için sözleşmeye gecikme faizi veya cezası konabilir mi; konabilirse dayanağı ve üst sınırı nedir (TBK temerrüt hükümleri, 6502 sayılı Kanun, MEB tip sözleşmesindeki hüküm)?
- **Bugünkü varsayım:** Gecikme bedeli hesaplanmaz; sistem yalnız taksiti "Gecikmiş" olarak gösterir. Bedel ancak onaylı sözleşmede açıkça yazılıysa ve yasal tavanı aşmıyorsa açılabilecek, varsayılan kapalı bir seçenektir.
- **Kodda:** Gecikme durumu türetilir (`invoiceStatus`, `lib/format.ts`; `financeOverview`); gecikme bedeli kalemi yok.
- **Cevap değişirse:** Mevzuat profiline tavan oranı, sözleşmeye gecikme hükmü ve ayrı gecikme kalemi eklenir.
- **Cevap:** bekleniyor

#### H-05 · Kart komisyonu veliye yansıtılabilir mi

- **Kural:** `DOM-FIN-013`, `DOM-FIN-004`; ADR 0007 açık soruları. Muhasebe tarafı M-06.
- **Soru:** Kartla ödemede ödeme kuruluşunun kestiği komisyonu veliye ayrı bir tutar olarak yansıtmak, ilan dışı ad altında ücret alma ve süreli ödemede ilan ücretini aşma yasağına (ÖÖKY md. 54/1-a, b, d ve 55/4) aykırı mı?
- **Bugünkü varsayım:** Karar verilmedi. Sistem yalnız tarifede ilan edilmiş kalemlerle borç açtığı ve ödeme koşulu yalnız indirim yönünde fiyat farkı taşıdığı için (`lib/payment-terms.ts`) komisyonu veliye yansıtamaz; komisyon kurumda kalır.
- **Kodda:** Çevrim içi ödeme kapalıdır (`invoice.payOnline`, `TODO(payment-provider)`); tarife kalem türleri sabit listedir (`FEE_ITEM_KINDS`).
- **Cevap değişirse:** Yansıtma uygunsa tarifeye ilanlı bir kart ödeme farkı kalemi ve sağlayıcı ayarı eklenir; uygun değilse ADR 0007'ye "komisyonu kurum üstlenir" kararı yazılır.
- **Cevap:** bekleniyor

#### H-06 · Kampüs ödeme hizmeti lisansı gerektirir mi

- **Kural:** `DOM-FIN-032`; ADR 0007 karar 1 ve 3; ister listesi "Kartla tahsilat".
- **Soru:** Parayı hiç tutmayan, kartla ödemeyi kurumun kendi sanal POS'u ya da lisanslı bir ödeme kuruluşu üzerinden doğrudan kurumun hesabına geçecek biçimde başlatan Kampüs, ödeme hizmeti lisansı almak zorunda mı?
- **Bugünkü varsayım:** Gerekmez; kart bilgisi sağlayıcının sayfasında girilir, her kurum kendi üye iş yeridir ve para doğrudan kurumun bildirilmiş hesabına geçer.
- **Kodda:** Çevrim içi ödeme kapalıdır (`invoice.payOnline`, `PROVIDER_CONFIRMATION_ACTIONS`, `lib/authorize.ts`); sağlayıcı seçilmedi.
- **Cevap değişirse:** ADR 0007'deki model değişir (ör. yalnız banka sanal POS'u, alt üye iş yeri modelinin yasaklanması ya da lisanslı ortakla çalışma); sağlayıcı seçim ölçütleri güncellenir.
- **Cevap:** bekleniyor

### Sözleşme ve belgeler

#### H-07 · Bakanlık tip sözleşmesi

- **Kural:** `DOM-FIN-010`, `DOM-KAY-012`.
- **Soru:** Bakanlığın belirleyip yayımladığı güncel tip sözleşme (ÖÖKY md. 53/1) hangisidir, kurslar (dil okulu) için de geçerli mi ve kurum ödeme planı ile iade koşullarını sözleşmeye ek olarak koyabilir mi?
- **Bugünkü varsayım:** Her kesin kayıt ve yenilemede tip sözleşmenin bir sürümü kullanılacaktır; ödeme planı sözleşmenin parçasıdır.
- **Kodda:** Sözleşme kaydı tip sözleşme sürümünü taşımaz; sözleşme PDF'i "Örnek sözleşme metnidir" uyarısıyla üretilir (`apps/web-react/src/lib/pdf/templates/contract.ts`).
- **Cevap değişirse:** Sözleşme kaydına tip sözleşme sürümü ve metni, PDF şablonuna resmî metin eklenir; kurs türü için ayrı şablon gerekebilir.
- **Cevap:** bekleniyor

#### H-08 · Sözleşmede elektronik onayın geçerliliği

- **Kural:** `DOM-FIN-010`; ister listesi "Sözleşme imzası" (kurucu ya da temsilcisi imzalar, md. 31/4).
- **Soru:** Velinin (ya da yetişkin kursiyerin) kayıt sözleşmesini ve taksit planını uygulamada vereceği elektronik onayla (ıslak imza olmadan) kabul etmesi geçerli midir; geçerliyse hangi ispat bilgisi (kimlik doğrulama, zaman, metin sürümü) saklanmalıdır?
- **Bugünkü varsayım:** Ödeyici onayı "imza veya elektronik onay" olarak zamanıyla saklanacaktır; onaylanan sözleşme değişmez, değişiklik ek protokoldür.
- **Kodda:** Onay alanı yok; sözleşme kesin kayıtta onaysız oluşur (`lib/enrollment.ts`). Kurum tarafında imza yetkilisi alanı yok (IST-092).
- **Cevap değişirse:** Elektronik onay geçersizse sözleşme ıslak imzalı belgenin taranmış kopyasıyla kapanır; geçerliyse onay ekranı ve ispat kaydı yazılır.
- **Cevap:** bekleniyor

#### H-09 · Taksit taahhütnamesi metninin hukuki uygunluğu

- **Kural:** `DOM-FIN-051`, `DOM-FIN-025`.
- **Soru:** Veliye imzalatılan "Ödenmemiş taksitleri vade tarihlerinde ödemeyi taahhüt ederim." cümleli taksit taahhütnamesi hukuken yeterli ve ÖÖKY'ye uygun mu; ödenmeyen taksitte kalan borcun tamamının istenmesi gibi ek hükümler konabilir mi?
- **Bugünkü varsayım:** Taahhütname yalnız ödeme planını, tahsilat özetini, bu tek taahhüt cümlesini ve imza alanını taşır. Burslu öğrenciye düzenlenmez, çünkü bursluya burs belgeleri dışında maddi yükümlülük doğuran belge (senet, taahhüt) düzenlenemez (ÖÖKY md. 58/4, 62, 63/3).
- **Kodda:** `apps/web-react/src/lib/pdf/templates/payment-plan.ts`; bursluda gizlenir (`hasScholarshipContract`, `lib/payments.ts`); öğrenci rolüne açık değildir.
- **Cevap değişirse:** Taahhüt metni ve ek hükümler şablona yazılır; metin tip sözleşmeye bağlanırsa sürümlü tutulur.
- **Cevap:** bekleniyor

#### H-10 · Ergin olmayanın ve 18 yaşını dolduran öğrencinin sözleşmesi

- **Kural:** `DOM-KAY-012`; `DOM-DIL-090`, `DOM-DIL-091`.
- **Soru:** 18 yaş altı öğrencinin sözleşmesini velinin yapması yeterli mi; okulda 18 yaşını doldurmuş öğrencide veliyi sözleşme tarafı ve ödeyici yapmak geçerli mi, yoksa sözleşmeyi öğrencinin kendisi mi imzalamalıdır (TMK md. 11–12)?
- **Bugünkü varsayım:** Okulda her yaşta en az bir veli zorunludur ve ödeyici veli olabilir (kullanıcı kararı, 2 Kasım 2026). Kursta 18 yaş ve üstü kursiyer kendi sözleşme tarafı ve ödeyicisidir, 18 yaş altında veli yapar.
- **Kodda:** `guardianRequired(institutionType, birthDate, now)` (`lib/enrollment.ts`, `lib/age.ts`); 422 `guardian_required`, `guardian_not_applicable`.
- **Cevap değişirse:** Okulda 18 yaşını dolduran öğrenci için sözleşme tarafı ayrılır (veli yalnız ödeyici ya da kefil olur); kayıt formu ve sözleşme şablonu değişir.
- **Cevap:** bekleniyor

#### H-11 · 18 yaşına giren kursiyerin süren borcu

- **Kural:** `DOM-DIL-092`.
- **Soru:** Velinin imzaladığı kurs sözleşmesinin ödeme yükümlülüğü, kursiyer sözleşme süresi içinde 18 yaşına girince süre sonuna kadar velide mi kalır?
- **Bugünkü varsayım:** Evet; veli imzalı sözleşme ve ödeyici süre sonuna kadar değişmez, yeni sözleşmeyi kursiyer yapar.
- **Kodda:** Yok; 18 yaşa giriş işlenmiyor.
- **Cevap değişirse:** 18 yaş gününde ödeyici devri ve kursiyere yeni onay akışı gerekir.
- **Cevap:** bekleniyor

### Ücret iadesi ve cayma

#### H-12 · Mevzuat metinlerinin güncelliği

- **Kural:** `DOM-FIN-002`, `DOM-FIN-005`, `DOM-FIN-021`, `DOM-FIN-026`, `DOM-FIN-040`; `README.md` kaynak listesi; ister listesi §4.3.
- **Soru:** ÖÖKY'nin ücret, indirim, burs ve iade maddeleri (md. 53–63) 16/2/2024 değişikliğinden sonra değişti mi ve 5580 sayılı Kanun md. 13'ün yürürlükteki metni kural belgelerindekiyle aynı mı?
- **Bugünkü varsayım:** Kurallar RG 16/2/2024 değişikliğine kadarki konsolide ÖÖKY metnine dayanır; 5580 md. 13 metni kısmen ikincil kaynaklardan görüldü, md. 56 iade oranları bir avukat sitesindeki alıntıdan alındı.
- **Kodda:** Oranlar sabit ya da parametredir: iade kesintisi `REFUND_DEDUCTION_BASIS_POINTS` (%10), indirim tavanı `DISCOUNT_CAP_BASIS_POINTS` (%50), artış tavanı `tuitionIncreaseCeiling` (+5 puan), ücretsiz okutma `freeQuotaCount` (%3).
- **Cevap değişirse:** Değişen oran ya da süre mevzuat profilinde yeni eğitim yılı sürümüyle güncellenir; eski sözleşmeler kendi sürümüyle kalır.
- **Cevap:** bekleniyor

#### H-13 · İadenin hesap tabanı

- **Kural:** `DOM-FIN-040`; ADR 0006 "Sonuçlar".
- **Soru:** Ayrılışta %10 kesinti ve okunan süre payı, sözleşmenin indirimler düşüldükten sonraki net ücreti üzerinden mi, yoksa ilan edilen indirimsiz yıllık ücret üzerinden mi hesaplanır?
- **Bugünkü varsayım:** Net ücret üzerinden hesaplanır (veli lehine).
- **Kodda:** `quoteWithdrawal` tabanı `contract.netCents`'tir (`lib/withdrawals.ts`), paket satışında da saat payı net üzerinden işler; döküm `student_withdrawals.breakdown`'da saklanır.
- **Cevap değişirse:** Kesinti tabanı ve iade dökümü PDF'i değişir; geçmiş dökümler kendi kopyasıyla kalır.
- **Cevap:** bekleniyor

#### H-14 · "Öğrenim görülen gün" nasıl sayılır

- **Kural:** `DOM-FIN-040`; ADR 0006 "Sonuçlar".
- **Soru:** Öğretim yılı başladıktan sonra ayrılışta "öğrenim görülen gün" MEB çalışma takviminin ders günleriyle mi, takvim günüyle mi sayılır?
- **Bugünkü varsayım:** Ders günüyle sayılır (profil parametresi `refundDayBasis`).
- **Kodda:** Görülen ve toplam gün yönetici tarafından elle girilir (`withdrawal-quote` ucu); çalışma takvimi ve kurum profili yok (OG-269).
- **Cevap değişirse:** Varsayılan gün esası ve takvimden otomatik sayım değişir.
- **Cevap:** bekleniyor

#### H-15 · Ek hizmetlerin iadesi

- **Kural:** `DOM-FIN-040`, `DOM-FIN-003`; ADR 0006 "Sonuçlar".
- **Soru:** Yemek, servis gibi ek hizmetlerin ücreti ayrılışta kullanılmayan süre oranında mı iade edilir ve öğrenim ücretindeki %10 kesinti bunlara da uygulanır mı?
- **Bugünkü varsayım:** Kullanılmayan süre oranında, kesintisiz iade edilir.
- **Kodda:** `quoteWithdrawal` ek hizmet taksitlerini ayrı satır olarak hesaplar (`extras`, kullanılan pay `share`); %10 kesinti yalnız öğrenim ücretine uygulanır.
- **Cevap değişirse:** Ek hizmet satırının hesabı ve iade dökümü değişir.
- **Cevap:** bekleniyor

#### H-16 · Burslu öğrencinin ayrılışında iade

- **Kural:** `DOM-FIN-040`, `DOM-FIN-025`.
- **Soru:** "Kurumdan ayrılan burslu öğrenciden okuduğu süre için ücret istenmez" hükmü (ÖÖKY md. 62/5; 5580 md. 13/5) uyarınca, kısmi burslu öğrencinin ayrılışta ödediği öğrenim ücretinin tamamı mı iade edilir, yoksa yalnız normal iade hesabına göre hak edilenden fazla ödediği kısım mı?
- **Bugünkü varsayım:** Ödenenden fazlası istenmez, normal hesabı aşan kısım iade edilir; yani hak edilen tutar "normal hesap ile ödenenin küçüğü"dür. Burs öğrenim ücretini kapsar; ek hizmetin kullanılan payı bursludan da istenir.
- **Kodda:** `quoteWithdrawal` `scholarshipExempt` (`lib/withdrawals.ts`): hak edilen = en az (normal hesap, ödenen öğrenim ücreti).
- **Cevap değişirse:** Ödenen öğrenim ücretinin tamamı iade edilecekse burslu ayrılışında hak edilen sıfır olur; ek hizmetin istisnaya girip girmediği de netleşir.
- **Cevap:** bekleniyor

#### H-17 · Çevrim içi satışta cayma hakkı

- **Kural:** `DOM-FIN-042`; ister listesi §4.3 "Mesafeli kayıt".
- **Soru:** Dil okulu paketinin kurum binasına gelinmeden tamamen çevrim içi satılması mesafeli sözleşme sayılır mı; sayılırsa cayma süresi, istisnalar ve ÖÖKY'deki iade kuralıyla ilişkisi nedir (6502 sayılı Kanun, Mesafeli Sözleşmeler Yönetmeliği)?
- **Bugünkü varsayım:** Sayılabilir; kurum bu kanalı açarsa cayma süresi sözleşmede yazılır ve süre içindeki ayrılışta kesinti yapılmaz. Süre ister listesindeki genel 14 gündür, sözleşme gününden sayılır ve son gün dahildir.
- **Kodda:** Çevrim içi paket satışı yok; paket yalnız yönetici ve ön büro tarafından satılır (`POST /api/v1/finance/package-sales`, ON-058, K-07). Kural, süre ve ön bilgilendirme verisi saf fonksiyondur (`distanceSaleWithdrawal`, `distanceSalePreInformation`, `lib/finance-distance-sale.ts`); K-07 çevrim içi satışı kapattığı için çağıran yok, kanal açılırsa ekran o işle yazılır.
- **Cevap değişirse:** Çevrim içi satışta ön bilgilendirme ve cayma metni ile cayma süresi içindeki kesintisiz iade yolu eklenir (IST-078).
- **Cevap:** bekleniyor

#### H-18 · Kurum kaynaklı grup iptalinde tam iade

- **Kural:** `DOM-DIL-042`.
- **Soru:** Asgari sayıya ulaşmadığı için açılmayan grupta, kursiyere ücretin tamamını kesintisiz iade etmek doğru mu; ÖÖKY md. 56/3-b'deki %10 kesinti yalnız kursiyerin kendi isteğiyle ayrılışında mı uygulanır?
- **Bugünkü varsayım:** Kesinti yalnız kursiyer kaynaklı ayrılışta uygulanır; kurum kaynaklı iptalde tam iade yapılır.
- **Kodda:** Grup açılışı ve iptali `planGroupOpen`, `planGroupCancellation` (`lib/language-groups.ts`); iptale bağlı iade akışı yok.
- **Cevap değişirse:** Grup iptalinde iade hesabının kesinti oranı değişir.
- **Cevap:** bekleniyor

#### H-19 · Paket saatlerinin süre dolunca yanmaması

- **Kural:** `DOM-DIL-051`.
- **Soru:** Paketin kullanım süresi dolduğunda kullanılmayan ders saatlerinin silinmesi ("saat yanar" koşulu) 6502 sayılı Kanun açısından geçerli olabilir mi?
- **Bugünkü varsayım:** Geçerli değildir; kullanılmayan saatler silinmez, kursiyerin seçimine göre süre uzatılır ya da iade hesabına girer (ÖÖKY md. 56/3-b ve 4).
- **Kodda:** Saat silinmez: son kullanma günü geçince `packageSaleStatus` `expired` döner, `remainingHours` aynı kalır; yeni tüketim durur (`package_expired`), süre `POST /api/v1/finance/package-sales/:saleId/extend` ile uzatılır (`lib/finance-packages.ts`, ON-058). Süre dolumunda otomatik iade hesabı yok.
- **Cevap değişirse:** Paket kuralına süre dolumu seçeneği eklenir.
- **Cevap:** bekleniyor

### Kayıt, aday ve kişisel veri

#### H-20 · Kâğıt rızanın personelce sisteme girilmesi

- **Kural:** `DOM-KAY-035`; ayrıca `DOM-YTK-057`, `DOM-YTK-058`, `DOM-ILT-034`.
- **Soru:** Velinin kâğıt formda ıslak imzayla verdiği açık rızayı (fotoğraf/video paylaşımı, konuşma kaydı) kurum personelinin, taranmış formu saklayarak sisteme girmesi geçerli bir rıza kaydı sayılır mı?
- **Bugünkü varsayım:** Sayılmaz; rızayı yalnız velayetli veli (18 yaşını doldurmuş öğrencide öğrencinin kendisi) kendi hesabından verir, personel rıza veremez ve giremez. Kesin kayıt rıza yazmaz; personele yalnız hangi rızaların beklendiğini gösterir.
- **Kodda:** `requireConsentAuthority` (`lib/consents.ts`); ıslak imza taraması kanalı yok; kayıt sonrası bildirim `apps/web-react/src/pages/crm/EnrollmentConsentNotice.tsx` (`GET /api/v1/consents/status`).
- **Cevap değişirse:** Rıza kaydına "ıslak imza taraması" kanalı, taranmış belge eki ve personel giriş yetkisi eklenir; `DOM-YTK-057`/`-058` kuralları ve kesin kayıt ekranı değişir.
- **Cevap:** bekleniyor

#### H-21 · Ticari elektronik ileti onayı ve İYS

- **Kural:** `DOM-KAY-004`, `DOM-KAY-009`; `DOM-FIN-035`; ister listesi §4.5.
- **Soru:** Adaya ve veliye gönderilecek tanıtım iletileri için onay ve İYS kaydı hangi durumda zorunludur (6563 sayılı Kanun md. 6), ödeme hatırlatması, randevu teyidi ve referans kampanyası duyurusu bu kapsamın neresindedir?
- **Bugünkü varsayım:** Tanıtım iletisi (kampanya, indirim, bursluluk sınavı duyurusu) kanal bazında onay ister; ödeme hatırlatması, randevu teyidi, sözleşme ve tahsilat bilgilendirmesi hizmet iletisidir, onay istemez.
- **Kodda:** Onay kanal bazında saklanır (`marketingConsent`, `setProspectMarketingConsent`, `hasMarketingConsent`, `lib/prospects.ts`); tanıtım iletisi gönderen işlem ve İYS bağlantısı yok (OG-108).
- **Cevap değişirse:** Hizmet iletisi sayılan bildirimler onay denetimine bağlanır; İYS kaydı zorunluluğu kurum ayarına girer.
- **Cevap:** bekleniyor

#### H-22 · Aday verisinin saklama ve imha süresi

- **Kural:** `DOM-KAY-008`.
- **Soru:** Vazgeçen ya da 12 ay temas görmeyen adayın verisini en geç bir sonraki periyodik imha döneminde (en fazla 6 ay) anonimleştirmek, Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hâle Getirilmesi Hakkında Yönetmelik'e uygun mu?
- **Bugünkü varsayım:** Uygun; 12 ay işletme kuralıdır, dönüşüm istatistiği için yalnız kaynak, aşama ve tarih kalır.
- **Kodda:** Yok; otomatik imha işi yok.
- **Cevap değişirse:** İmha işinin süresi ve tutulan alanlar değişir.
- **Cevap:** bekleniyor

#### H-23 · Borç nedeniyle karne ve belge alıkonamaz

- **Kural:** `DOM-KAY-025`, `DOM-FIN-034`.
- **Soru:** Kurum, ödenmemiş öğrenim ücreti nedeniyle yenilemeyi reddedebilir (ÖÖKY md. 55/2); ama karne, not ve belgeleri alıkoyamaz yorumu doğru mu?
- **Bugünkü varsayım:** Doğru; borç akademik kayıtlara erişimi engellemek için kullanılmaz.
- **Kodda:** Borç hiçbir akademik erişimi kapatmaz; yenileme borç denetimi yapmaz (ON-030).
- **Cevap değişirse:** Belge erişimine borç koşulu eklenebilir ya da yenilemede borç onayı zorunluluğu değişir.
- **Cevap:** bekleniyor

#### H-24 · Kayıt dondurmanın MEBBİS kaydına etkisi

- **Kural:** `DOM-DIL-052`.
- **Soru:** Dil okulunda kayıt dondurma MEBBİS'teki kursiyer kaydında nasıl işlenmelidir (kayıt kapatılıp dönüşte yeniden mi açılır)?
- **Bugünkü varsayım:** ÖÖKY'de dondurma hükmü bulunamadı; dondurma ayrılış sayılmaz ve taksit planı dondurma süresince ertelenir.
- **Kodda:** Yok; dondurma işlemi yok.
- **Cevap değişirse:** Dondurmada "MEBBİS'e işlendi" işareti ve kayıt kapatma/yeniden açma adımı eklenir. Bu soru il/ilçe millî eğitim müdürlüğüne de yöneltilebilir.
- **Cevap:** bekleniyor

#### H-25 · İşverene kursiyer raporunun dayanağı

- **Kural:** `DOM-DIL-093`.
- **Soru:** İşverenin ödediği kurumsal eğitimde işverene kursiyerin devam oranı ve kur sonucunu bildirmenin hukuki dayanağı sözleşmenin ifası mıdır, açık rıza mı gerekir (KVKK md. 4, 10)?
- **Bugünkü varsayım:** Kayıtta aydınlatma yapılarak yalnız devam oranı ve kur sonucu raporlanır; yazma ürünleri, ses kayıtları ve öğretmen yorumları verilmez.
- **Kodda:** `DOM-FIN-060` (ON-100): kursiyer şirkete bağlanırken aydınlatma yapıldığı onaylanır; katılım özeti yalnız devam saatleri, katılım oranı, devam şartı ve onaylı kur sonucunu verir (`lib/finance-corporate.ts`, `GET /api/v1/finance/corporate-customers/:customerId/attendance-report`). Şirket yetkilisinin girişi yok; rapor personel ekranında ve dosyadadır.
- **Cevap değişirse:** Rapor açık rızaya bağlanır; kayıtta işveren raporu rızası alınır, rızası olmayan kursiyer rapora girmez.
- **Cevap:** bekleniyor

## Mali müşavire

#### M-01 · Eğitim hizmetinde fatura ve e-Arşiv zorunluluğu

- **Kural:** `DOM-FIN-050`; ister listesi §4.4.
- **Soru:** Kurumun velilerden aldığı öğrenim ve ek hizmet ücretleri için fatura (e-Fatura ya da e-Arşiv) düzenlemesi zorunlu mu; Kampüs'ün ürettiği tahsilat dekontu bu yükümlülüğün yerine geçer mi?
- **Bugünkü varsayım:** Dekont kurum içi tahsilat belgesidir; fatura veya e-Arşiv yerine geçmez. Kampüs fatura düzenlemez; fatura yükümlülüğü kurumda ve muhasebe programındadır.
- **Kodda:** Dekont PDF'i "fatura veya e-arşiv yerine geçmez" notunu taşır (`apps/web-react/src/lib/pdf/templates/payment-receipt.ts`); tahsilata kurum ve yıl içinde ardışık dekont numarası verilir. Muhasebe aktarımı CSV ya da `.xlsx`'tir (`DOM-FIN-055`); entegratör bağlantısı yok (IST-112).
- **Cevap değişirse:** Entegratöre fatura isteği (IST-112) önceliklenir ya da dekont şablonu değişir.
- **Cevap:** bekleniyor

#### M-02 · e-Fatura ve e-Arşiv eşikleri

- **Kural:** `DOM-FIN-050`; ister listesi §4.4.
- **Soru:** 2025'ten itibaren brüt satış hasılatı 3 milyon TL ve üzeri olanların e-Fatura/e-Arşiv'e geçmesi ve diğerlerinin vergiler dahil 3.000 TL'yi aşan işlemlerde e-Arşiv düzenlemesi kuralları özel okul ve kurslar için güncel mi?
- **Bugünkü varsayım:** Bu eşikler ikincil kaynaktan alındı; ürün kararını etkilemediği için sistemde tutulmuyor.
- **Kodda:** Yok.
- **Cevap değişirse:** Kurum ayarına e-Arşiv yükümlülüğü bilgisi ve fatura isteği akışı eklenir.
- **Cevap:** bekleniyor

#### M-03 · KDV oranı

- **Kural:** `DOM-FIN-050`; ADR 0006 karar 8 (IST-104); ister listesi §4.4.
- **Soru:** Eğitim hizmetinde KDV oranı bugün %10 mu ve yemek, servis, kitap-kırtasiye, kıyafet gibi ek hizmetlerde hangi oranlar uygulanır?
- **Bugünkü varsayım:** Eğitim hizmetinde %10 (10.07.2023'ten itibaren); yan hizmetlerde oran farklı olabilir.
- **Kodda:** KDV oranı tarife kaleminde tarihli tutulur (`lib/fee-tariffs.ts`, on binde birlik); sistem KDV tutarı hesaplamaz.
- **Cevap değişirse:** Tarife kaleminin varsayılan oranları ve gerekiyorsa KDV hesabı eklenir.
- **Cevap:** bekleniyor

#### M-04 · Taksitli ücrette fatura zamanı

- **Kural:** `DOM-FIN-055`; ADR 0006 karar 11; ister listesi §4.4.
- **Soru:** Birden fazla vergilendirme dönemine yayılan taksitli eğitim ücretinde fatura ne zaman düzenlenir (her ay sonundan itibaren 7 gün içinde mi, tahsilatta mı)?
- **Bugünkü varsayım:** Muhasebe aktarımı dönem bazında yapılır; tahsilat ödeme gününde artı, iptal gününde eksi satırdır, taksit vade gününe göre listelenir.
- **Kodda:** `lib/finance-export-profile.ts`, `GET /api/v1/finance/exports` (CSV ve `format=xlsx`) ve `/api/v1/finance/export-profile` uçları.
- **Cevap değişirse:** Aktarım satırlarının dönem esası (tahsilat günü mü, hizmet dönemi mi) değişir.
- **Cevap:** bekleniyor

#### M-05 · Kartla ödenen taksitte dekont ve e-Arşiv

- **Kural:** `DOM-FIN-050`; ADR 0007 açık soruları.
- **Soru:** Velinin kartla ödediği taksit için Kampüs dekontu yeterli mi, yoksa e-Arşiv belgesi düzenlenmesi gerekir mi; gerekiyorsa ödeme kuruluşunun belgesi bu ihtiyacı karşılar mı?
- **Bugünkü varsayım:** Dekont fatura yerine geçmez; kartla ödeme de diğer tahsilatlar gibi dekont alır.
- **Kodda:** Çevrim içi ödeme kapalıdır (`invoice.payOnline`, `TODO(payment-provider)`).
- **Cevap değişirse:** Kartla tahsilatta fatura isteği ya da sağlayıcı belgesi akışı ADR 0007'ye eklenir.
- **Cevap:** bekleniyor

#### M-06 · Kart komisyonunun muhasebesi

- **Kural:** `DOM-FIN-013`; ADR 0007 açık soruları. Hukuki tarafı H-05.
- **Soru:** Ödeme kuruluşunun kestiği komisyon kurumun gideri olarak mı kaydedilir; veliye yansıtılırsa ayrı faturalanması ve KDV'si nasıl olur?
- **Bugünkü varsayım:** Karar verilmedi; komisyon veliye yansıtılmaz, kurumda kalır.
- **Kodda:** Yok; tahsilat kaydı brüt tutarı tutar, komisyon alanı yok (`payments`).
- **Cevap değişirse:** Tahsilat kaydına komisyon ve net tutar alanı, muhasebe aktarımına komisyon satırı eklenir.
- **Cevap:** bekleniyor

#### M-07 · Tahsilat kayıtlarının saklama süresi

- **Kural:** `DOM-FIN-033`, `DOM-FIN-053`.
- **Soru:** Tahsilat, iptal, iade kayıtları ve dekontlar VUK'a göre ne kadar süre saklanmalıdır?
- **Bugünkü varsayım:** Tahsilat silinmez, ters kayıtla iptal edilir; finans denetim izi süre veya adetle kesilmez.
- **Kodda:** İptal `POST /api/v1/payments/:paymentId/reverse`; satır silinmez. Saklama süresi sonunda imha kuralı yok.
- **Cevap değişirse:** Finans kayıtları için saklama süresi ve süre sonrası imha/anonimleştirme kuralı yazılır.
- **Cevap:** bekleniyor

#### M-08 · Referans hakkının vergi durumu

- **Kural:** `DOM-FIN-024`. Ticari ileti tarafı H-21.
- **Soru:** Referans veren veliye hakkın yalnız sonraki sözleşmesine ilanlı indirim kalemi olarak verilmesi vergi açısından sorun doğurur mu; nakit ya da hediye çeki verilseydi hangi yükümlülük doğardı?
- **Bugünkü varsayım:** Referans hakkı yalnız indirim kalemidir; nakit ödeme, hediye çeki veya borçtan bağımsız para iadesi yapılmaz.
- **Kodda:** Bugünkü varsayımla: hak yalnız sözleşmede indirim kalemidir (`lib/finance-referrals.ts`, ON-139); nakit ya da hediye çeki yolu yoktur.
- **Cevap değişirse:** Referans hakkının biçimi ve sözleşmedeki gösterimi değişir.
- **Cevap:** bekleniyor

#### M-09 · Kasa gün sonu kaydının defter niteliği

- **Kural:** `DOM-FIN-033` (kasa ve gün sonu, ON-064).
- **Soru:** Gün sonu kapanış kaydı VUK anlamında kasa defteri yerine geçer mi; kasa farkı nasıl muhasebeleşir ve kaydın saklama süresi nedir (`M-07` ile birlikte)?
- **Bugünkü varsayım:** Kayıt iç kontrol aracıdır, yasal defter sayılmaz; fark açıklamayla tutulur, muhasebe kaydı üretmez.
- **Kodda:** `lib/finance-day-closings.ts`, `POST /api/v1/finance/day-closings/:closingDate/close`.
- **Cevap değişirse:** Kapanışa defter alanları ve fark için muhasebe aktarım satırı eklenir.
- **Cevap:** bekleniyor

#### M-10 · Paket satışında ilan altı fiyatın indirim tavanına sayılması

- **Kural:** `DOM-FIN-001`, `DOM-DIL-050` (paket satışı, ON-058).
- **Soru:** Dil okulu paketinde ilan edilen saat ücretinin altında satış, %50 indirim tavanı hesabında indirim sayılır mı?
- **Bugünkü varsayım:** Sayılır (temkinli); ilan fiyatının yarısının altındaki satış reddedilir.
- **Kodda:** ON-058 paket satışı kuralı.
- **Cevap değişirse:** Tavan yalnız adı konmuş indirimlere uygulanır.
- **Cevap:** bekleniyor

#### M-11 · Yıl sonu mutabakatının hesap kodu ve KDV dökümü

- **Kural:** `DOM-FIN-056`; `DOM-FIN-055`; IST-111.
- **Soru:** Yıl sonu mutabakat dosyasında hangi hesap kodları (120, 340, 600 vb.) kullanılmalı, KDV dökümü istenir mi, ayrılış düzeltmesi ve ödenen iade muhasebeye nasıl yansır, eğitim yılı ile mali yıl farkı nasıl ele alınır?
- **Bugünkü varsayım:** Sistem hesap kodu ve KDV tutarı üretmez; kurum gerekiyorsa aktarım profilinde sabit sütun ekler. Mutabakat dönemi eğitim yılıdır, mali yıl değildir.
- **Kodda:** `lib/finance-reconciliation.ts`, `lib/finance-export-profile.ts` (mutabakat sütunları); hesap kodu ve KDV sütunu yok.
- **Cevap değişirse:** Mutabakat dosyasına hesap kodu eşlemesi ve KDV kırılımı eklenir, dönem seçeneği genişler.
- **Cevap:** bekleniyor

#### M-12 · Paket satışında gelir tanıma

- **Kural:** `DOM-FIN-058`; `DOM-DIL-051`; IST-114.
- **Soru:** Dil okulu paketinin ücreti gelire hangi anda yazılır: satışta mı, ders saati kullanıldıkça mı? Süresi dolan ve kullanılmayan saatin ücreti ne zaman gelir olur; saat yanmadığına göre (H-19) iade yükümlülüğü sürerken ertelenmiş gelirde mi kalır?
- **Bugünkü varsayım:** Gelir kullanılan saat oranıyla tanınır (net ücret × birikimli kullanılan saat ÷ alınan saat, aşağı yuvarlanır). Süresi dolan saat gelir sayılmaz, ertelenmiş gelirde kalır. İade edilen saatin payı gelirden düşer; kesinti ve ödenen iade ayrılış kaydındadır. Hesap kodu ve KDV dökümü yoktur.
- **Kodda:** `lib/finance-package-report.ts` (`packageHourReport`), `GET /api/v1/finance/package-report`.
- **Cevap değişirse:** Tanıma anı ve süresi dolan saatin gelire alınma kuralı rapor hesabında değişir; ekran ve CSV sütunları aynı kalır.
- **Cevap:** bekleniyor

#### M-14 · Kurumsal müşteriye toplu fatura

- **Kural:** `DOM-FIN-060`; IST-089.
- **Soru:** Şirket adına eğitim alan kursiyerlerin taksitleri şirkete tek belgeyle faturalanırken belge e-Fatura mı olmalıdır (şirket e-Fatura mükellefiyse); satırda kursiyer adı yazılabilir mi; fatura dönemi vade günüyle mi (tahakkuk) yoksa hizmet ayıyla mı belirlenir; ödenmiş taksit faturaya girer mi?
- **Bugünkü varsayım:** Kampüs'ün toplu faturası kurum içi toplu dökümdür, vergi belgesi değildir; resmi fatura kurumun muhasebe programında bu dökümden kesilir. Dönem vade günüyle belirlenir, ödenmiş taksit de girer (K-46). Satırda kursiyer adı, taksit numarası, vade ve tutar yazar; KDV kırılımı yoktur.
- **Kodda:** `lib/finance-corporate.ts` (`billableLines`, `corporateInvoiceCsv`), `POST /api/v1/finance/corporate-invoices`, PDF `apps/web-react/src/lib/pdf/templates/finance-corporate.ts`.
- **Cevap değişirse:** Toplu fatura entegratöre (IST-112) gönderilir, KDV kırılımı ve hizmet dönemi eklenir; satırdaki kişi adı kaldırılabilir.
- **Cevap:** bekleniyor

## Öneriyle uygulanan kararlar

Aşağıdakiler proje sahibinin onayını bekleyen ürün kararlarıdır; kod öneriyle yazılmıştır. Onaylanınca "Kararlaştırılanlar" tablosuna taşınır, değişirse "Değişirse" sütunundaki yer güncellenir.

| Kimlik | Tarih      | Kural         | Uygulanan öneri                                                                                                                              | Değişirse                                                                      |
| ------ | ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| K-45   | 2026-11-08 | `DOM-FIN-060` | Şirket bağı sözleşmenin ödeyici alanını değiştirmez; toplu fatura taksitleri bağ günlerinden seçer. Sözleşmede `corporate` ödeyici türü yok. | Sözleşme ödeyicisine şirket türü eklenir (`contracts_payer_check`, migration). |
| K-46   | 2026-11-08 | `DOM-FIN-060` | Dönemde vadesi gelen taksit ödenmiş olsa da toplu faturaya girer; satırda ödeme durumu görünür.                                              | `billableLines` ödenmiş taksiti dışlar.                                        |
| K-47   | 2026-11-08 | `DOM-FIN-060` | Bütün kalem türleri (öğrenim, kitap, materyal) toplu faturaya girer.                                                                         | `billableLines` kalem türü süzer.                                              |
| K-48   | 2026-11-08 | `DOM-FIN-060` | Şirketin tek ödemesi taksitlere otomatik dağıtılmaz; tahsilat her kursiyerin taksitine mevcut ekrandan girilir.                              | Toplu tahsilat ayrı görev olur (ödeme dağıtımı, `DOM-FIN-030`).                |
| K-49   | 2026-11-08 | `DOM-FIN-060` | Katılım özeti yalnız bugün etkin bağlı kursiyerleri gösterir; bağı biten çalışan rapordan çıkar.                                             | Rapor dönem alır, bağın içindeki kayıtları da gösterir.                        |
| K-50   | 2026-11-08 | `DOM-FIN-060` | Şirket bağı kursiyerin yaşını denetlemez; işveren eğitimi yetişkine yöneliktir.                                                              | 18 yaş altı kursiyer bağlanamaz (`planEmployeeLink`).                          |
| K-51   | 2026-11-08 | `DOM-FIN-060` | Toplu faturayı yönetici ve ön büro keser; iptal yalnız yöneticidedir (tahsilat iptali gibi).                                                 | Rol dizileri (`CORPORATE_*_ROLES`) değişir.                                    |
| K-52   | 2026-11-08 | `DOM-FIN-060` | Faturalanmış taksit ek protokolle değişirse yeni taksit yeniden faturalanmaz; fark için toplu fatura iptal edilip yeniden kesilir.           | Fark faturası (ek döküm) üretilir.                                             |
| K-53   | 2026-11-08 | `DOM-FIN-060` | Toplu fatura numarası `KF-<yıl>-<sıra>`; yıl Europe/Istanbul, sıra kurumda yıl içinde ardışık, iptal edilen numara boşta kalır.              | `corporateInvoiceNumber` biçimi değişir.                                       |

#### M-13 · Ödenen iadenin gün sonu ve kapalı gün kuralı

- **Kural:** `DOM-FIN-036`, `DOM-FIN-041`; IST-113, IST-110.
- **Soru:** Ayrılış iadesi kurumdan çıkan paradır. Gün sonu raporu yöntem bazında yalnız tahsilat ve iptali özetliyor. Ödenen iade gün sonuna "iade ödemesi" satırıyla (banka çıkışı) girmeli mi; girerse kapatılmış güne geriye tarihli iade ödemesi de tahsilat gibi reddedilmeli mi? İade hangi kurum hesabından ödendiği kaydedilmeli mi?
- **Bugünkü varsayım:** İade IBAN'a havaleyle ödenir; ödeme günü ayrılış gününden önce, bugünden sonra olamaz (ON-093), ama gün sonuna girmez ve kapalı güne de yazılabilir. Kurumun ödeme yaptığı hesap kaydedilmez.
- **Kodda:** `planRefundPayment` (`lib/withdrawals.ts`), `POST /api/v1/withdrawals/:withdrawalId/pay-refund`; gün sonu `lib/finance-day-closings.ts`.
- **Öneri:** İade ödemesine kurumun bildirilmiş banka hesabı seçilsin (`DOM-FIN-032`); gün sonu raporu banka yönteminde ayrı "iade ödemesi" adedi ve tutarı göstersin, net bundan düşsün; kapalı güne iade ödemesi `finance_day_closed` ile reddedilsin. Nakit iade kapsam dışı kalsın. Rapor damgası ve kapanış satırı yeni alanı taşıyacağı için migration gerekir.
- **Cevap değişirse:** Öneri uygulanır; değişmezse gün sonu bugünkü gibi yalnız tahsilattır, iade yıl sonu mutabakatında ve muhasebe aktarımında izlenir.
- **Cevap:** bekleniyor (ürün kararı ve mali müşavir)

## Kararlaştırılanlar

Aşağıdakiler soru değildir; proje sahibinin kararıdır ve kural belgelerine "kullanıcı kararı" olarak işlenmiştir.

| Kimlik | Tarih      | Kural                        | Karar                                                                                                                                                                                                                                 | Etkilenen yer                                                                 |
| ------ | ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| K-01   | 2026-11-03 | `DOM-FIN-032`                | Senet alındığı anda tahsilat sayılır ve taksiti kapatır; senedin vadesi ayrıca izlenmez.                                                                                                                                              | `PAYMENT_METHODS` `Senet` (`lib/payments.ts`), ON-018                         |
| K-02   | 2026-11-03 | `DOM-FIN-005`                | Artış tavanındaki ÜFE ve TÜFE oranları kurum başına, eğitim yılı için girilir.                                                                                                                                                        | `tuitionIncreaseCeiling` (`lib/fee-tariffs.ts`); yenileme API'si (ON-030)     |
| K-03   | 2026-11-03 | `DOM-FIN-005`                | 1, 5 ve 9. sınıf kademe başıdır; bu sınıflara yenilemede artış tavanı uygulanmaz.                                                                                                                                                     | Yenileme tavan denetimi (ON-030)                                              |
| K-04   | 2026-11-03 | `DOM-FIN-052`, `DOM-FIN-035` | Ödeyici veli, velayeti olmasa da ödeyicisi olduğu öğrencinin finans bilgisini görür.                                                                                                                                                  | Finans okuma kapsamı ve bildirim alıcısı (ON-291; `DOM-ILT-074`, Oğuzhan #33) |
| K-05   | 2026-11-03 | `DOM-KAY-012`, `DOM-KAY-013` | Veli hesabını personel açar: veli kaydı girilir, hesabın göreceği öğrenci seçilir.                                                                                                                                                    | Kesin kayıttan veli hesabı açma (ON-290, ON-128; veli daveti ucu Oğuzhan #32) |
| K-06   | 2026-11-06 | `DOM-FIN-040`                | Öğrenci ayrılırken bütün yürürlükteki sözleşmeleri (paket satışı dahil) iade ve borç hesabına girer.                                                                                                                                  | Ayrılış (`lib/withdrawals.ts`), ON-296                                        |
| K-07   | 2026-11-06 | `DOM-DIL-050`                | Paket satışını yönetici ve personel (ön büro) yapar; veli kendi başına satın almaz.                                                                                                                                                   | Paket satışı (ON-058)                                                         |
| K-08   | 2026-11-06 | `DOM-FIN-033`                | Gün sonunda iptal edilen nakit kasadan çıkmış sayılır; kasadan bankaya aktarım izlenmez, açıklama yeterlidir.                                                                                                                         | Gün sonu (ON-064)                                                             |
| K-09   | 2026-11-06 | `DOM-KAY-040`                | Kayıt hunisinde danışman adayı açan personeldir.                                                                                                                                                                                      | Kayıt hunisi (ON-051)                                                         |
| K-10   | 2026-11-06 | `DOM-KAY-020`                | Yenilemeden önce veliye ayrı davet gönderilir; veli çevrim içi yanıt verir, plan ve sözleşme onayı ayrı kalır.                                                                                                                        | Yenileme daveti (ON-056)                                                      |
| K-11   | 2026-11-06 | `DOM-FIN-002`                | Tarife süresinde ilan edilmezse önceki yılın yayımlı tarifesi geçerli kalır.                                                                                                                                                          | Kesin kayıt ve yenileme, ON-297                                               |
| K-12   | 2026-11-06 | `DOM-FIN-040`                | Ayrılışta sözleşmelerin ödeyicileri farklıysa iade otomatik yazılmaz; alacak kişiyi yönetici gerekçeyle seçer.                                                                                                                        | Ayrılış (`lib/withdrawals.ts`), ON-296                                        |
| K-13   | 2026-11-06 | `DOM-FIN-040`                | Ayrılışta ödeyici seçim gerekçesini yalnız yönetici görür; dökümde ad değil tür yazar.                                                                                                                                                | Ayrılış, ON-296                                                               |
| K-14   | 2026-11-06 | `DOM-FIN-024`                | Referans hakkının değeri kayıt anında sabitlenir; tam bursta hak doğmaz, iadesiz erken ayrılışta kalır, iptal bildirimi gitmez, iptal edilen yenilemedeki hak sahibine döner.                                                         | Referans programı, ON-139                                                     |
| K-15   | 2026-11-06 | `DOM-KAY-015`                | e-Özel listesinde tam kimlik tek satırda "Göster" ile açılır ve denetime yazılır, CSV maskeli kalır; işlenmiş satır sonradan değişirse "e-Özel'de düzeltilmeli" diye listede kalır; ön büro CSV indirebilir.                          | e-Özel, ON-083                                                                |
| K-16   | 2026-11-06 | `IST-007`                    | Pilot aktarımda tutar TL ya da kuruş olabilir; geçmiş ödeme "açılış aktarımı" diye ayrılır, kasayı değiştirmez, mutabakatta tutmayan çıkmaz. `read-excel-file` kabul edildi.                                                          | Pilot aktarım, ON-060, ON-061, ON-085                                         |
| K-17   | 2026-11-06 | `DOM-FIN-003`                | Dönem ortasında ek hizmet tutarını personel tarifenin üstüne çıkmadan düzeltebilir, aylık tarifede her ay ayrı taksit açılır; kulüp ücret türüdür. Ayrılışta tutar yöneticiye gösterilir, H-15 cevabına kadar otomatik iade yazılmaz. | Ek hizmet, ON-087, ON-298                                                     |
| K-18   | 2026-11-06 | `DOM-KAY-002`, `DOM-KAY-004` | Web formu mükerrer başvuruda not düşer. Formdan gelen ticari onay, kişi doğrulanana kadar İYS'ye gönderilmez ve kampanyada kullanılmaz. Denetimde gerçek sistem aktörü kullanılır. Kapalı modülde açık uçlar 404 döner.               | Ön başvuru formu, ON-133                                                      |
| K-19   | 2026-11-06 | `IST-111`                    | Mutabakat formülü: açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − açılış aktarımı + iptal + iade = kapanış; mali müşavire de gösterilir. Dil okulu ve kursta önceki yıl tarifesi taşınmaz. Paket satışında burs yok.             | ON-085, ON-297, ON-058                                                        |
| K-20   | 2026-11-07 | `DOM-KAY-024`                | Dondurmada serbest metin neden tutulmaz; yalnız kategori ("belgeli neden") saklanır, sağlık ayrıntısı yazılmaz (KVKK özel nitelikli veri).                                                                                            | ON-067                                                                        |
| K-21   | 2026-11-07 | `DOM-DIL-051`, `DOM-FIN-040` | Kullanılan paket saati yoklamaya bağlanana kadar personel elle girer; paket ayrılışında iade tutarı yönetici onayından geçer.                                                                                                         | ON-300                                                                        |
| K-22   | 2026-11-07 | `DOM-FIN-022`                | Yenilemede kardeş indirimi yalnız aynı eğitim yılında aktif kaydı olan kardeş varsa uygulanır; ilk çocuk almaz.                                                                                                                       | ON-301                                                                        |
| K-23   | 2026-11-07 | `DOM-KAY-002`                | Ön başvuru günlük tavanı dolunca yöneticiye uyarı çıkar; başvuru sessizce kaybolmaz.                                                                                                                                                  | ON-133                                                                        |
| K-24   | 2026-11-07 | `DOM-DIL-050`                | Öğrenci kalan paket saatini telefonda görür; ödeme bilgisi sayılmaz, ders planlaması içindir.                                                                                                                                         | ON-302                                                                        |
| K-25   | 2026-11-07 | `DOM-KAY-024`                | Dondurmada taksit otomatik ertelenmez; plan ek protokolle elle değiştirilir.                                                                                                                                                          | ON-067                                                                        |
| K-26   | 2026-11-07 | `DOM-KAY-024`                | Dondurmadaki "6 ay" süresi 183 gün sayılır.                                                                                                                                                                                           | ON-067                                                                        |
| K-27   | 2026-11-07 | `DOM-DIL-045`                | İki programı olan kursiyer dondurulunca bütün grupları birlikte donar.                                                                                                                                                                | ON-067                                                                        |
| K-28   | 2026-11-07 | `DOM-FIN-024`                | Referans hakkı paket satışında kullanılmaz; kesin kayıt ve yenileme sözleşmesinde işaretlenir, toplu yenilemede sunulmaz.                                                                                                             | ON-139                                                                        |
| K-29   | 2026-11-07 | `DOM-KAY-024`                | Dondurma reddi kapalı kategoriyle yapılır: belge eksik, süre aşıldı, kur sınırı, diğer. Serbest metin yok.                                                                                                                            | ON-067                                                                        |
| K-30   | 2026-11-07 | `DOM-FIN-040`                | Ayrılış nedeninde sağlık kategorisi kalkar, yerine "belgeli neden" gelir; sağlık ayrıntısı yazılmaz.                                                                                                                                  | ON-303                                                                        |
| K-31   | 2026-11-07 | `DOM-KAY-002`                | Ön başvuru tavan uyarısını yalnız yönetici görür; ön büroya eklenmez.                                                                                                                                                                 | ON-133                                                                        |
| K-32   | 2026-11-07 | `DOM-KAY-027`                | Veli çocuğunun, öğrenci kendisinin belgesini de indirebilir; her indirme denetim kaydına düşer.                                                                                                                                       | ON-304                                                                        |
| K-33   | 2026-11-07 | `DOM-FIN-057`                | Muhasebe kurum genelini görür; kampüs kapsamı sonra seçenek olur.                                                                                                                                                                     | ON-069                                                                        |
| K-34   | 2026-11-07 | `DOM-FIN-057`                | Muhasebe aktarım profilini düzenleyebilir; `DOM-FIN-055` buna göre güncellenir.                                                                                                                                                       | ON-069                                                                        |
| K-35   | 2026-11-07 | `DOM-FIN-057`                | İadeyi onaylayan yönetici ödemesini de işleyebilir; onaylayan ve ödeyen denetimde ayrı görünür.                                                                                                                                       | ON-069                                                                        |
| K-36   | 2026-11-07 | `DOM-FIN-057`                | Günü kapatan kişi o günün tahsilatını kaydedenden farklı olmak zorunda değildir.                                                                                                                                                      | ON-069                                                                        |
| K-37   | 2026-11-07 | `DOM-FIN-057`                | MEBBİS ve e-Özel ücret kaydını muhasebe işlemez; yönetici ve ön büro işler.                                                                                                                                                           | ON-069                                                                        |
| K-38   | 2026-11-07 | `DOM-FIN-057`                | Ek protokol muhasebeye açılmaz (görev ayrılığı).                                                                                                                                                                                      | ON-069                                                                        |
| K-39   | 2026-11-07 | `DOM-FIN-057`                | Muhasebe rolü iki adımlı doğrulama (OG-136) ile birlikte açılır.                                                                                                                                                                      | ON-069                                                                        |
| K-40   | 2026-11-07 | `DOM-FIN-058`                | Paket satış listesi veli ve öğrenciye tutar göndermez; yalnız saat ve son kullanma.                                                                                                                                                   | ON-305                                                                        |
| K-41   | 2026-11-07 | `DOM-FIN-058`                | Paket satış listesi veli ve öğrenciye kimlik alanlarını (sözleşme, tarife, sürüm) da göndermez.                                                                                                                                       | ON-306                                                                        |
| K-42   | 2026-11-07 | `DOM-KAY-024`                | Kur ortasında "belgeli neden" ile dondurma belge beyanı ister; kur sınırında istenmez.                                                                                                                                                | ON-067                                                                        |
| K-43   | 2026-11-07 | `DOM-DIL-051`, `DOM-FIN-040` | Elle girilen kullanılan saat, ayrılış tarihinden sonra girilse de iade hesabına sayılır (fazla iade önlenir).                                                                                                                         | ON-300                                                                        |
| K-44   | 2026-11-07 | `DOM-KAY-027`                | Öğrenci belgesi ileride ayrı "Belgelerim" sayfasına taşınır; sayfa Oğuzhan alanındadır.                                                                                                                                               | ON-304                                                                        |
