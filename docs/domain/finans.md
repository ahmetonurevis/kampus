# Finans

Ücret ilanından sözleşmeye, taksit, indirim, burs, tahsilat, gecikme, iade ve belgelere kadar kurumun para akışı. Kayıt yaşam döngüsü [kayit-ve-crm.md](kayit-ve-crm.md), dil okulu paket ve saat satışı [dil-okulu.md](dil-okulu.md) içindedir. **Doğrulanmalı** maddelerin hukukçu (H-) ve mali müşavir (M-) soruları ile kullanıcı kararları [finance-dogrulanacak-sorular.md](finance-dogrulanacak-sorular.md) içindedir.

Bu dosyadaki yasal sayılar (ilan ayları, %50 indirim tavanı, %10 iade kesintisi, artış formülündeki +5 puan, %3 ücretsiz okutma) kodda sabitlenmez. Hepsi eğitim yılına göre sürümlü mevzuat profilinin parametresidir (bkz. `DOM-AKD-001`). Bir sözleşme hangi profil sürümüyle hesaplandıysa o sürümle kalır.

## Para ve ücret ilanı

### DOM-FIN-001 · Para birimi ve gösterim

- **Kural:** Bütün tutarlar Türk lirası cinsinden, kuruş birimli güvenli tamsayı olarak saklanır ve hesaplanır. Kayan nokta yalnız kullanıcı girdisini ayrıştırırken kullanılır; girdi en fazla iki ondalık basamak alır ve hemen kuruşa çevrilir. Yüzde uygulanan tutarlar her adımda kuruşa yuvarlanır; yuvarlama farkı toplamı bozmaz (dağıtım `DOM-FIN-011`). Yabancı para ile ücret tespiti ve tahsilatı yapılmaz.
- **Gerekçe:** Ücretler TL olarak tespit edilir; kuruş tamsayısı yuvarlama hatasını ve mükerrer kuruş farkını önler.
- **Kaynak:** ÖÖKY md. 54/1-a (ücretler Türk lirası olarak tespit edilir); proje kuralı (CLAUDE.md).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/domain.js:22-26` kayıt tutarını tam TL alır ve `domain.js:126` kuruşa çevirir; yenileme `packages/school-core/src/lib/school-workflows.js:117-135` iki ondalığa izin verir. İki giriş kuralı farklıdır.

### DOM-FIN-002 · Ücret ilanı olmadan tahsilat ve sözleşme yok

- **Kural:** Kurum her eğitim yılı için bir **ücret tarifesi** yayımlar: öğrenim ücreti (düzey/program bazında), peşin ve süreli ödeme koşulları, uygulanacak indirim türleri ve oranları, ek hizmet ücretleri. Tarifenin ilan tarihi, MEBBİS'e işlendiği tarih ve işleyen kişi kaydedilir. O yıl için yayımlanmış tarife yoksa sözleşme, taksit ve tahsilat oluşturulamaz. Sözleşme tutarı tarifedeki ücretin altında olabilir, üstünde olamaz. İlan dönemi (`school`: ocak başı–mayıs sonu) profil parametresidir; dönem dışında yayımlanan tarife uyarı üretir. Süresinde ilan yapılmadıysa önceki yılın tarifesi geçerli kalır.
- **Gerekçe:** Kurum ilan etmeden ücret tahsil edemez ve ilan ettiği ücretin üzerinde ücret isteyemez.
- **Kaynak:** 5580 md. 13/1 (ocak–mayıs ilanı); ÖÖKY md. 54/1-a, c, ç, d ve 54/2. 2024 sonrası güncel metin **doğrulanmalı** (H-12).
- **Kurum türü:** ikisi (dil okulunda ders saati ücreti, `DOM-FIN-006`)
- **Kodda:** kısmen — tarife sürümü, ilan ve MEBBİS tarihi var (`lib/fee-tariffs.ts`, `POST /api/v1/fee-tariffs`, ADR 0006 karar 8). Kesin kayıt tutarı yayımlanmış tarifeden hesaplanır (`lib/enrollment.ts`). Yenileme de yayımlı tarife ister, ilanı aşamaz: tarifeli plan `POST /api/v1/finance/renewals` (`lib/renewals.ts`) ve iş akışı köprüsü (`assertRenewalWithinTariff`); çevrimdışı demo tutarı serbesttir. İlan dönemi dışındaki yayımda yayım penceresi uyarır, engellemez (`isOutsideAnnouncementPeriod`). İlan tutarını aşan fiyat editörde girilirken uyarı verir (`tariffItemExceedsAnnounced`, IST-104), yayımda reddedilir (`tariff_amount_exceeds_announced`).

### DOM-FIN-003 · Ek hizmetler ayrı kalemdir ve isteğe bağlıdır

- **Kural:** Yemek, kahvaltı, servis, pansiyon, kitap-kırtasiye, kıyafet ve etüt gibi hizmetler tarifede öğrenim ücretinden ayrı kalem olarak ilan edilir. Bunlar ayrı borç kalemi açar ve yalnız veli talep ettiyse sözleşmeye eklenir. Öğrenim ücretine gömülemez, öğrenim ücretinin indirimini koşula bağlamak için zorunlu tutulamaz.
- **Gerekçe:** Mevzuat bu hizmetleri ayrı tespit ve ilan ettirir; hizmetten talep eden veli yararlanır.
- **Kaynak:** ÖÖKY md. 53/5, 54/1-a son cümle.
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — ek hizmet ayrı taksit kaydıdır (`feeKind`, `lib/enrollment.ts`). Tarifeli yenileme de ek hizmeti ayrı taksit açar (`lib/renewals.ts`); iş akışı köprüsü kalem ayırmaz.

### DOM-FIN-004 · İlan dışı ad altında tahsilat yok

- **Kural:** Sistem yalnız tarifede tanımlı kalem türleriyle borç açar. "Bağış", "yardım", "kayıt ücreti", "materyal katkısı", "staj/yaz uygulaması" gibi tarifede olmayan adlarla borç veya tahsilat kaydı oluşturulamaz. Serbest açıklamalı elle borç girişi yoktur; düzeltme yalnız mevcut kalemin ters kaydıyla yapılır (`DOM-FIN-033`).
- **Gerekçe:** Yönetmelik ilan edilenler dışında hiçbir ad altında ücret alınmasını yasaklar.
- **Kaynak:** ÖÖKY md. 54/1-b, 55/4.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tarife kalem türü sabit listedir (`FEE_ITEM_KINDS`, `lib/fee-tariffs.ts`). Taksitin kalem türü henüz yok.

### DOM-FIN-005 · Devam eden öğrenciye artış sınırı

- **Kural:** `school` ara sınıflarında yeni yıl öğrenim ücreti şu tavanı aşamaz: `baz × (1 + ((ÜFE_ort + TÜFE_ort) / 2 + ek_puan) / 100)`. Baz, ara sınıfa yeni gelen için önceki yıl ilan edilen ücret, okulda devam eden öğrenci için kayıt sözleşmesindeki ücrettir. Ders yılı içinde kayıt olanın sonraki yıl ücreti, kayıt yılının ilan ücreti üzerinden hesaplanır. ÜFE ve TÜFE önceki yılın ortalamalarıdır; değerler kaynağıyla birlikte (TÜİK bülteni, tarih) kurum başına, eğitim yılı için girilir (kullanıcı kararı, 2026-11-03). `ek_puan` bugün 5'tir. 1, 5 ve 9. sınıf kademe başıdır, ara sınıf sayılmaz; bu sınıflara yenilemede tavan uygulanmaz (kullanıcı kararı, 2026-11-03). Yenileme planı tavanı aşan tutarla oluşturulamaz.
- **Gerekçe:** Mevcut veliyi sözleşme sonrası fahiş artıştan korur; MEB bu sınırı denetler.
- **Kaynak:** ÖÖKY md. 53/1 (RG 5/8/2023-32270 değişikliği). 2024 sonrası güncel metin **doğrulanmalı** (H-12).
- **Kurum türü:** `school`
- **Kodda:** var (core ve API) — tavan core `renewalCeiling` (`lib/renewal-ceiling.ts`; hesap `tuitionIncreaseCeiling`, kuruş tamsayısı, aşağı yuvarlanır). Baz son sözleşmenin indirimsiz ücreti (`grossCents`), sözleşmesi olmayanda önceki yılın ilan ücretidir; baz da yoksa tavan hesaplanamaz (`no_base`, ekranda uyarı). Atlanan yıllarda oranlar sırayla uygulanır. ÜFE/TÜFE oranı kurum başına girilir (kullanıcı kararı, 2026-11-03): `price_index_rates` (migration `0050`; `GET/POST /api/v1/finance/renewals/price-indexes`, `PATCH …/:academicYear`, yazma yönetici). Tarifeli plan (`POST /api/v1/finance/renewals`) ve iş akışı köprüsü tavanı aşan tutarı 422 `renewal_above_tariff`/`renewal_above_ceiling`, oranı girilmemiş yılı 422 `price_index_missing` ile reddeder. Kademe başlangıç sınıfı (1, 5, 9) ara sınıf sayılmaz, tavan uygulanmaz (kullanıcı kararı, 2026-11-03). Ders yılı içinde kayıt olanın bazı sözleşmesindeki tarife ücretidir; ayrı bir kısmi yıl kuralı yok. Ekran: Kayıt Yenileme sayfasında ücret özeti ve `Artış tavanı oranları` bölümü (`/yonetici/kayit-yenileme`, `/onburo/kayit-yenileme`).

### DOM-FIN-006 · Ücret birimi kurum türüne göre

- **Kural:** `school` öğrenim ücretini **yıllık** tespit eder; taksitler yıllık ücretin bölümüdür. `language_school` öğrenim ücretini **ders saati ücreti** olarak tespit eder; paket fiyatı `saat × saat ücreti − ilanlı indirimler` ile türetilir ve iade bu saat ücretine göre hesaplanır (`DOM-FIN-040`). Paket kurgusu `DOM-DIL` içindedir.
- **Gerekçe:** İade ve indirim tabanı ücret birimine bağlıdır.
- **Kaynak:** ÖÖKY md. 55/1-a, c. Dil kursunun MEB lisanslı "özel öğretim kursu" olması varsayılmıştır; lisanssız (ticari) dil okulu için ÖÖKY uygulanmaz ve bu kurum için **doğrulanmalı** (H-01).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tarife yayımı öğrenim ücreti birimini kurum türüyle denetler (`planTariffPublish`). Paket yok; iade hesabı `quoteWithdrawal`'dadır.

## Sözleşme ve taksit

### DOM-FIN-010 · Sözleşme tarafları, içerik ve değişmezlik

- **Kural:** Her kesin kayıt ve yenileme için bir sözleşme oluşur. Sözleşmede Bakanlığın yayımladığı tip sözleşme sürümü, ödeyici (`DOM-KAY-012`), öğrenci, eğitim yılı, sınıf/program, tarife sürümü, brüt ücret, her indirim kalemi, net ücret, ek hizmetler ve taksit planı bulunur. Ödeyici onayı (imza veya elektronik onay) zamanıyla saklanır. Onaylanmış sözleşmenin tutarı ve planı değiştirilemez; değişiklik ek protokol olarak yeni sürümle yapılır ve eski sürüm salt okunur kalır.
- **Gerekçe:** Sözleşme sonraki yıl artış tabanıdır (`DOM-FIN-005`) ve iade hesabının girdisidir.
- **Kaynak:** ÖÖKY md. 53/1 (Bakanlıkça belirlenip yayımlanan özel sözleşme). Güncel tip sözleşme **doğrulanmalı** (H-07); elektronik onayın geçerliliği **doğrulanmalı** (H-08).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — sözleşme kesin kayıtta (`lib/enrollment.ts`; ödeyici, tarife sürümü, brüt, indirim dökümü, net, ek hizmet ve burs kopyasıyla) ve yenilemede (`lib/school-workflows.ts`) oluşur. Onay ve ek protokol (IST-092) `lib/contract-approval.ts`, durum ve belge planı `lib/contract-status.ts`; API `POST /api/v1/finance/contracts/:contractId/signatory` (imza yetkilisi: kurucu ya da kurucu temsilcisi, yalnız yönetici), `…/approve` (ödeyici onayı: veli kendi hesabıyla elektronik, yalnız ödeyiciyse; yönetici ve ön büro ıslak imzayı işler; taze oturum), `…/amendments` (ek protokol taslağı) ve `…/cancel-amendment`; hepsi `Idempotency-Key` ve `If-Match` ister. Onay zamanı, onaylayan, yöntem, ödeyici adı ve plan kopyası `approval` alanında saklanır. Onaylı kaydın `invoiceIds` ve `classId` dışındaki alanları değişmez; migration `0056_protect_approved_contracts` `records` üzerinde koşullu tetikleyiciyle 55000 döndürür. Ek protokol yeni kayıttır (`revision`, `amendsContractId`, gerekçe); tahsilat görmüş öğrenim taksitleri ve ek hizmetler korunur, kalan net yeni plana dağıtılır; indirim yalnız sözleşmenin tarifesinden yeniden hesaplanır (DOM-FIN-020, -021). Yeni plan ancak ek protokol imzalanıp onaylanınca taksitlere geçer; arada tahsilat gelirse 409 `contract_amendment_stale`. Onaysız ek protokol ve yerini ek protokole bırakan sürüm iadenin tabanı olmaz (`isContractInForce`). Web (ON-040): Finans & Tahsilat "Sözleşmeler" sekmesi ve sağ panel (`apps/web-react/src/pages/finance/ContractsSection.tsx`, `ContractPanel.tsx`) durumu, imza yetkilisini, onay biçimi ve zamanını, belgedeki planı gösterir; imza yetkilisi (yönetici), ıslak imzalı onay, ek protokol ve iptal kısa formdur. Veli onay bekleyen sürümü Sözleşmeler sayfasında elektronik onaylar (`ContractApprovalPanel.tsx`, taze oturumda parola tekrarı). Durum ve düğme seçimi `packages/react-shared/src/contract-model.ts`, komutlar `use-contract-commands.ts`; e2e `tests/e2e-react/contract-approval.spec.ts`. Ödeyici olmayan veliye de düğme görünür, sunucu 403 `contract_payer_only` ile reddeder (oturum ödeyici bilgisini taşımaz). Bildirimler (ON-044): imza yetkilisi işlenince aynı transaction'da onay isteği (`contract_approval_requested`), ödeyici onayında onay tamamlandı (`contract_approved`) yazılır (`services/finance-contracts.ts`, türler `lib/finance-notifications.ts` `CONTRACT_NOTIFICATION_TYPES`); ek protokol yeni sürüm olarak imzalanınca yeni istek alır. Kitle yaş değil ödeyicidir (`contractPayerIsGuardian`): veli ödeyicide veli, yetişkin kursiyerde kendisi. Anahtar sözleşme sürümüdür; imza yetkilisi düzeltmesi ve tekrar istek ikinci bildirim yazmaz, iletişim modülü kapalıyken işlem sürer, bildirim yazılmaz; veri yalnız sözleşme kimliğidir. Veli bildirimini velayetli veliler görür; velayeti olmayan ödeyici veli görmez, çünkü ödeyici bağının açtığı türler (`PAYER_NOTIFICATION_KINDS`) taksit, tahsilat ve iadeyle sınırlıdır. Test `apps/api/test/contract-notifications.test.ts`. Yok: Bakanlık tip sözleşme sürümü ve metni, ek hizmet değişikliği, yetişkin kursiyerin kendi elektronik onayı (görevli işler), mobil onay ekranı. Elektronik onayın hukuki geçerliliği **doğrulanmalı**.

### DOM-FIN-011 · Taksit planı toplamı sözleşmeye eşittir

- **Kural:** Taksit tutarlarının toplamı sözleşmenin net tutarına kuruşu kuruşuna eşittir. Bölünemeyen kuruşlar ilk taksitlere birer kuruş eklenerek dağıtılır. Taksit sayısı 1 ile kurum ayarındaki üst sınır (varsayılan 12) arasındadır. Vade ayın aynı günüdür; o gün yoksa ayın son günü alınır. Vade tarihleri Europe/Istanbul takvim gününe göre değerlendirilir.
- **Gerekçe:** Plan ile sözleşme ayrışırsa veli borcunu doğrulayamaz.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/domain.js:30-41` (dağıtım), `domain.js:127-152` ve `school-workflows.js:794-821` (vade kırpma).

### DOM-FIN-012 · Sözleşme yalnız kendi taksitlerini çözümler

- **Kural:** Bir sözleşmenin belgesi, durumu ve iadesi yalnız o sözleşmeye bağlı taksitler üzerinden hesaplanır (`invoiceIds`/`contractId`). Aynı öğrencinin başka yıl sözleşmesinin taksitleri karışmaz.
- **Gerekçe:** Yenileme ile öğrencinin iki açık sözleşmesi olur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/document-data.js:20-36`, `school-workflows.js:840`. Kesin kayıt sözleşmesi de `invoiceIds` taşır (`lib/enrollment.ts`); alanı olmayan eski kayıtlarda belge öğrencinin bütün taksitlerine düşer (`document-data.ts`).

### DOM-FIN-013 · Peşin ve süreli ödeme koşulu ilandadır

- **Kural:** Peşin ödeme indirimi, erken kayıt indirimi ve taksit sayısına bağlı fiyat farkı tarifede ilan edilmiş olmalıdır. Peşin indirimi bir indirim türüdür ve `DOM-FIN-021` tavanına dahildir. Süreli ödemede ilan ücretinin üstüne çıkılamaz; vade farkı adıyla ilan ücretini aşan tutar tahsil edilemez.
- **Gerekçe:** İlanda peşin/süreli ödeme koşulları ve indirimler belirtilir; ilan üstü ücret istenemez.
- **Kaynak:** ÖÖKY md. 54/1-a, d. Kart komisyonunun veliye yansıtılması **doğrulanmalı** (H-05, M-06).
- **Kurum türü:** ikisi
- **Kodda:** yok.

## İndirim, burs ve ücretsiz okutma

### DOM-FIN-020 · İndirim yalnız ilanlı türden seçilir

- **Kural:** İndirim serbest tutar olarak girilmez. Tarifedeki türlerden (kardeş, peşin, erken kayıt, referans, kurumsal anlaşma, personel çocuğu vb.) seçilir. Her indirim kaleminin türü, oranı veya tutarı, koşulu ve onaylayan kişi sözleşmede saklanır. İndirim ilan ücreti üzerinden hesaplanır; zincirleme (indirimli tutara ikinci indirim) yoktur.
- **Gerekçe:** Mevzuat kurumca belirlenecek indirimlerin ilanda belirtilmesini ister. Serbest indirim ilan dışı uygulama ve kayıt dışı pazarlık riski taşır.
- **Kaynak:** ÖÖKY md. 54/1-a.
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — `priceEnrollment` (`lib/enrollment.ts`). Yenilemede de (`planRenewal`, `lib/renewals.ts`); iş akışı köprüsü serbest indirimi reddeder (422 `discount_not_in_tariff`).

### DOM-FIN-021 · Toplam indirim tavanı

- **Kural:** Bir sözleşmedeki indirimlerin toplamı ilan edilen öğrenim ücretinin %50'sini aşamaz. Tavanın oranı profil parametresidir. Tavanın tek istisnası, aynı kurucuya ait kurumlarda görev yapan personelin çocuğudur; bu istisna personel kaydına bağlanır ve ayrıca onaylanır. Tavan aşılırsa sözleşme oluşturulmaz ve hangi kalemin aşırdığı gösterilir. Burs (`DOM-FIN-025`) ve ücretsiz okutma (`DOM-FIN-026`) indirim değildir, ayrı kayıt türüdür. Burs adıyla tavanı aşan indirim verilmesini önlemek için burs yalnız tanımlı burs programından atanır.
- **Gerekçe:** Mevzuat indirim oranını sınırlar; sınırsız indirim haksız rekabet ve ilanın anlamsızlaşması demektir.
- **Kaynak:** ÖÖKY md. 54/1-a. Burs ve ücretsiz okutmanın %50 tavanına dahil olmadığı yorumu ÖÖKY md. 62/4'e (burslu oranı ücretsiz oranının dışında tutulur) ve bursun ayrı bölümde düzenlenmesine dayanır; **doğrulanmalı** (H-02).
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — `DISCOUNT_CAP_BASIS_POINTS`, 422 `discount_cap_exceeded`; personel çocuğu istisnası yönetici onayıyla. Yenilemede de uygulanır; tavanla düşen ücret indirimi karşılayamazsa 422 `discount_exceeds_gross`. Personel kaydına bağlama henüz yok. Burs (`DOM-FIN-025`) tavan hesabına girmez.

### DOM-FIN-022 · Kardeş indirimi

- **Kural:** Kardeş indirimi, aynı kurumda aynı veliye bağlı (`DOM-KAY-013`) ve aynı eğitim yılında aktif kaydı olan ikinci ve sonraki çocuğa uygulanır. Hangi çocuğun "ikinci" sayılacağı tarifede tanımlıdır (varsayılan: düşük ücretli olan). Kardeş bağı ön büro önerisi ve onayıyla kurulur, otomatik kurulmaz.
- **Gerekçe:** Kardeş indirimi aile bağına dayanır; bağ yanlış kurulursa indirim haksız uygulanır.
- **Kaynak:** İşletme kuralı; ilan zorunluluğu ÖÖKY md. 54/1-a.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — aynı veliye bağlı aktif kardeş ve "ikinci çocuk" sırası denetlenir (`requireSiblingDiscountEligible`, `lib/enrollment.ts`; kesin kayıt, yenileme ve ek protokol aynı kuralı çağırır; ON-109). Tarife sıra tanımlamadığı için varsayılan uygulanır: ücret, kardeşin son yürürlükteki sözleşmesinin ilan ücretidir (brütü olmayan eski sözleşmede tutar); en yüksek ücretli çocuk ilk çocuktur ve indirim almaz, eşit ücrette önce kaydolan öndedir, kesin kayıttaki aday eşitlikte sonradır; sözleşmesi olmayan kardeşin ücreti bilinmediğinden aday lehine öne sayılır. İlk çocuk sonradan değişirse (ör. pahalı kardeş sonra kaydolur) cari sözleşmeler kendiliğinden değişmez, indirim ek protokolle taşınır. Tarifede sıra tanımı ve yıl denetimi (kardeşin aynı eğitim yılında aktif kaydı) yok.

### DOM-FIN-023 · İndirim koşulu kalkınca

- **Kural:** Kardeşin ayrılması gibi nedenlerle indirim koşulu ortadan kalkarsa cari yıl sözleşmesi değişmez. Bir sonraki yılın ücreti, öğrencinin kayıt olduğu yıldaki **indirimsiz** ücrete her öğrenim yılı için `DOM-FIN-005` oranı uygulanarak bulunur. Sistem yenileme planında bunu gerekçesiyle gösterir.
- **Gerekçe:** Mevzuat indirim şartı kalkan öğrencinin sonraki yıl ücretinin nasıl bulunacağını ayrıca düzenler.
- **Kaynak:** ÖÖKY md. 53/1 son cümle. Cari yıl sözleşmesinin korunması işletme kuralıdır.
- **Kurum türü:** `school`
- **Kodda:** var (core ve API) — kardeş indirimli son sözleşmede aynı veliye bağlı aktif kardeş kalmadıysa tavanın bazı kayıt yılındaki indirimsiz ücrettir ve her yılın oranı sırayla uygulanır (`renewalCeiling`, `tuitionAfterDiscountLoss`); gerekçe önizlemede ve plan kaydında `ceiling.discountLoss` olarak döner, cari sözleşme değişmez. Yalnız kardeş koşulu tespit edilir; diğer indirim koşulları (personel, kurumsal) henüz yok.

### DOM-FIN-024 · Referans indirimi

- **Kural:**
  - Referans indirimi yalnız o yılın tarifesinde ilan edilmiş bir indirim türüyse uygulanır.
  - Hak, referans veren veli/öğrenci adayın kaynağına bağlandıysa (`DOM-KAY-007`) ve referansla gelen aday kesin kayıt yapıp ilk taksitini ödediyse doğar.
  - Hak, referans verenin **açık veya bir sonraki sözleşmesine** indirim kalemi olarak eklenir. Nakit ödeme, hediye çeki veya borçtan bağımsız para iadesi yapılmaz.
  - Kalem `DOM-FIN-021` tavanına dahildir; tavanı aşan kısım düşer ve devretmez.
  - Bir aday yalnız bir referansa bağlanır. Kişi kendi çocuğu için referans olamaz; kardeş kaydı kardeş indirimidir (`DOM-FIN-022`).
  - Referansla gelen kayıt `DOM-FIN-040` kapsamında öğretim başlamadan iade alırsa, kullanılmamış referans hakkı iptal edilir. Kullanılmış hak geri istenmez.
- **Gerekçe:** Referans pazarlama aracıdır ama ilan dışı indirim veya kayıt dışı ödeme kanalına dönüşmemelidir.
- **Kaynak:** İşletme kuralı; ilan ve tavan ÖÖKY md. 54/1-a. Referans karşılığı nakit ödemenin ayrıca vergi ve ticari ileti yükümlülüğü doğurabileceği **doğrulanmalı** (M-08, H-21).
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-FIN-025 · Burs programı

- **Kural:** Burs, kurumun eğitim yılı için tanımladığı burs programından atanır. Programda şart, miktar veya oran, süre, burslu sayısı ve kesilme koşulları bulunur. Programın il millî eğitim müdürlüğüne bildirildiği tarih kaydedilir; bildirilmemiş program kullanılamaz. Burs sınavı ücretsizdir; tarihi profil penceresinde olmalıdır (bugün ocak–mart) ve valilik izni kaydı gerekir. Bursluya burs belgeleri dışında maddi yükümlülük doğuran belge (senet, taahhüt) düzenlenmez. Kurumdan ayrılan burslu öğrenciden okuduğu süre için ücret istenmez. Gerçek dışı beyanla alınmış burs iptal edilir; burslu dönem ücretleri kanuni faiziyle geri istenir. Burs ataması MEBBİS'e işlendi olarak işaretlenir.
- **Gerekçe:** Burs mevzuatta indirimden ayrı, bildirime ve sınav kurallarına bağlı bir kurumdur.
- **Kaynak:** 5580 md. 13/5; ÖÖKY md. 58/4, 62, 63/3.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — program ve atama core `lib/finance-scholarships.ts`, tablolar `scholarship_programs` ve `scholarship_awards` (migration `0032`, öğrenci başına yılda tek atama kısmi benzersiz indeksle). API `GET/POST /api/v1/finance/scholarship-programs`, `POST …/:programId/notify` (bildirim günü bir kez, gelecek gün 422), `GET /api/v1/finance/scholarship-awards`, `POST …/:awardId/mebbis-record`; yazma yalnız yönetici (`scholarship.manage`), okuma yönetici ve ön büro. Atama kesin kayıtta yapılır (`scholarshipProgramId`, `enrollProspectWithTariff`): yalnız yönetici (422 `scholarship_approval_required`), bildirilmemiş program 422 `scholarship_program_not_notified`, dolu kontenjan 409 `scholarship_capacity_full` (kurum kilidi altında sayılır). Öğrenciye aynı eğitim yılında ikinci burs 409 `scholarship_already_awarded`: yenilemede plan ve önizleme öğrencinin o yıldaki arşivlenmemiş atamasını kurum kilidi altında denetler (`hasStudentScholarshipAward`), kısıt yalnız yarışta tetiklenir; kesin kayıt her zaman yeni öğrenci kimliği açtığından orada çakışma olmaz. Oran ilan ücretinden hesaplanır, indirimlerden sonra kalan neti aşamaz; sözleşmeye `scholarship` kalemi yazılır, tam bursta öğrenim taksiti açılmaz. Yok: burs sınavı ve valilik izni (ON-136), kesilme ve geri isteme (ON-283), kayıtlı öğrenciye sonradan atama, ayrılışta burslu istisnası (ON-023), kayıtlı öğrenciye yenilemede atama tarifeli plandadır (`planRenewal`, yalnız yönetici, aynı işlemde `scholarship_awards`), iş akışı köprüsü serbest burs oranını reddeder (422 `scholarship_program_required`); planlanmış yenileme iptal edilince atama kalkmaz. Ekran: Finans sayfasında "Burslar" sekmesi (`?gorunum=burs`; ön büro yalnız görür) ve kesin kayıt formunun ücret adımında yalnız yöneticiye açılan burs seçimi, önizlemede burs kalemi.

### DOM-FIN-026 · Ücretsiz okutma kontenjanı

- **Kural:** Kurum öğrenci sayısının en az %3'ü kadar öğrenciyi ücretsiz okutur. Oran profil parametresidir; Bakanlık %10'a kadar artırabilir. Kesirli sonuç 0,5 ve üstündeyse yukarı yuvarlanır. Kanunda sayılan öncelikli çocuklar (harp/vazife malulü çocukları, koruma-bakım kararı olanlar) valilikçe yerleştirilir. Kontenjan dolmazsa kurumun değerlendirme kurulu EK-7/EK-8 formlarına göre seçer. Ücretsiz okuma hakkı yalnız o yıl veya dönem için geçerlidir; öncelikli çocuklar öğrenim süresince ücretsiz okur. Hak kazanandan alınmış ücret, okulda öğretim başladıktan sonra iki ay içinde iade edilir. Hak MEBBİS ve e-Okul'a işlenir (okulda eylül sonuna kadar).
- **Gerekçe:** Kanuni yükümlülüktür ve denetimde sayısal olarak aranır.
- **Kaynak:** 5580 md. 13/3 (mevzuat.gov.tr metni okundu); ÖÖKY md. 57-61.
- **Kurum türü:** ikisi (kurslar da kapsamdadır)
- **Kodda:** kısmen — sayı hesabı core `freeQuotaCount` (`lib/fee-tariffs.ts`, oran parametreli). Seçim, atama, iade süresi ve MEBBİS işareti yok.

## Tahsilat ve gecikme

### DOM-FIN-030 · Tahsilat ayrı kayıttır, kısmi ödeme mümkündür

- **Kural:** Her ödeme ayrı bir tahsilat kaydıdır: tutar (kuruş), tarih, yöntem, banka veya POS işlem referansı, kaydeden kişi, ilgili taksitler. Taksitin durumu (`Ödenmedi`, `Kısmi`, `Ödendi`, `Gecikmiş`) saklanmaz, tahsilatlardan türetilir. Kısmi ödeme kabul edilir. Fazla ödeme açık en eski taksite mahsup edilir; açık taksit yoksa iade alacağı olur. Mahsup sırası en eski vadeden başlar.
- **Gerekçe:** Gerçek tahsilatta taksit tutarı ile ödeme tutarı her zaman eşleşmez; durum alanını elle tutmak tutarsızlık üretir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — API `POST /api/v1/payments` ayrı kayıt, kısmi ödeme ve mahsup yapar (`lib/payments.ts`, ADR 0006). Taksitin `paidAt` alanı geçiş önbelleğidir; liste durumu henüz `Kısmi` üretmez, kısmi tutar `GET /api/v1/payments` dağılımından okunur. Tahsilat kaydı aynı transaction'da `payment_received` bildirimi yazar (IST-106, `lib/finance-notifications.ts`): yalnız tahsilat kimliği, tutar, yöntem ve referans yok; alıcı kuralı `DOM-FIN-035`'teki gibidir; `Idempotency-Key` tekrarı yazmaz, işlem geri alınırsa bildirim de kalmaz, iptal bildirim üretmez. Çevrimdışı demo ayrı `lib/payments-demo.ts` `payInvoice` ile tam ödeme işaretler; API, React, `api-client` ve `react-shared` bu yola ulaşmaz (`tests/payments-demo.test.ts`, ON-037). Yol Vue silinince (OG-072) ve mobil yalnız API'ye geçince (OG-074) kalkar.

### DOM-FIN-031 · Mükerrer tahsilat engeli

- **Kural:** Aynı ödeme iki kez işlenmez. Her tahsilat isteği bir idempotency anahtarı taşır; aynı anahtarla gelen ikinci istek yeni kayıt açmaz, ilk sonucu döndürür. Banka veya POS işlem referansı kurum içinde benzersizdir. Ödenmiş taksite ek tahsilat kaydedilmez. Tahsilat ile taksit durumu tek veritabanı işleminde yazılır. POS geri çağrısı tekrar gelirse yine ilk sonuç döner.
- **Gerekçe:** Çift tıklama, ağ yeniden denemesi ve POS tekrar bildirimleri en sık mükerrer ödeme nedenidir.
- **Kaynak:** İşletme kuralı; ADR 0001 (atomik yazım, sunucuda kural).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `Idempotency-Key` zorunlu, referans kurum içinde benzersiz (`payments_reference_key`, iptal edilenler hariç), yazım tek transaction'da. Çevrimdışı demo çevrim içi ödemede sabit `'Demo Sanal POS'` yazar (`apps/web/src/views/Finance.vue`).

### DOM-FIN-032 · Tahsilat kanalı banka hesabıdır

- **Kural:** Öğrenim ücreti, kurum adına açılmış ve Bakanlığa/valiliğe bildirilmiş banka hesabına havale/EFT ya da o hesaba bağlı POS ile tahsil edilir. Kurum ayarında bildirilmiş hesaplar tutulur; tahsilat bu hesaplardan birine bağlanır. Nakit tahsilat kurum ayarıdır (`cash_payments_enabled`), varsayılan kapalıdır ve yalnız yönetici açar (ADR 0006 karar 7, proje sahibinin kararı). ÖÖKY md. 55/3 ile uyumu **doğrulanmalı** (H-03); açmanın sorumluluğu kurumdadır. Tahsilatlar MEBBİS modülüne işlendi olarak işaretlenir.
- **Gerekçe:** Mevzuat eğitim ücretinin bildirilmiş banka hesabına yatırılarak tahsilini ve MEBBİS'e işlenmesini ister.
- **Kaynak:** ÖÖKY md. 55/3. Kampüs'ün ödeme hizmeti lisansı gerektirmediği **doğrulanmalı** (H-06, ADR 0007).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — API nakdi kurum ayarıyla denetler (`lib/payments.ts`, 422 `cash_payment_disabled`; `PATCH /api/v1/payment-settings`). Bildirilmiş hesaplar `/api/v1/bank-accounts` ile tutulur; hesap tanımlıysa nakit dışı tahsilat bir hesaba bağlanır (422 `bank_account_required`), hiç hesap tanımlanmadıysa tahsilat engellenmez. Senet (`Senet`, IST-106) banka kanalından geçmediği için hesaba bağlanmaz, referansı senet numarasıdır; burslu öğrenciden alınmaz (`scholarship_promissory_note`, DOM-FIN-025). Senet alındığı anda tahsilat sayılır ve taksiti kapatır (kullanıcı kararı, 2026-11-03); senedin vadesi ve karşılıksız çıkması ayrıca izlenmez. MEBBİS işareti `POST /api/v1/payments/:paymentId/mebbis-record` ile elle tutulur; MEBBİS'e bağlantı yoktur. Çevrimdışı demo formu ayarı bilmez (`apps/web/src/views/Finance.vue`).

### DOM-FIN-033 · Tahsilat silinmez, ters kayıtla düzeltilir

- **Kural:** Yanlış tahsilat silinmez ve tutarı değiştirilmez. Gerekçeli bir ters kayıtla iptal edilir, gerekirse doğru tahsilat yeniden girilir. İptal yetkisi yöneticidedir. İptal edilen tahsilatın dekontu "İptal edildi" ibaresiyle erişilebilir kalır.
- **Gerekçe:** Mali kayıt değiştirilirse mutabakat ve denetim imkânsızlaşır.
- **Kaynak:** İşletme kuralı. Ticari defter ve belge saklama süresi (VUK) **doğrulanmalı** (M-07).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `POST /api/v1/payments/:paymentId/reverse` (yalnız `yonetici`, gerekçe ve `If-Match` zorunlu). Ayrılmış öğrencide yalnız ayrılış sonrası borç tahsilatı iptal edilir (`DOM-FIN-041`). `İptal edildi` ibareli dekont belgesi henüz yok.

### DOM-FIN-034 · Gecikme durumu ve gecikme bedeli

- **Kural:** Vadesi (Europe/Istanbul takvim günü) geçmiş ve tam ödenmemiş taksit `Gecikmiş` sayılır. Gecikme gün sayısı vade gününden sonraki ilk günden başlar. Gecikme faizi veya cezası yalnız onaylı sözleşmede açıkça yazılıysa ve oranı profilde tanımlı yasal tavanı aşmıyorsa hesaplanır. Varsayılan kapalıdır. Gecikme bedeli ayrı kalemdir, öğrenim ücretine eklenmez. Borç, akademik kayıtlara erişimi engellemez (`DOM-KAY-025`).
- **Gerekçe:** Yasal dayanağı ve tavanı doğrulanmamış bir bedel otomatik uygulanırsa ilan dışı tahsilat sayılabilir (`DOM-FIN-004`).
- **Kaynak:** Gecikme durumu işletme kuralı. Gecikme faizinin dayanağı (TBK temerrüt hükümleri, 6502 sayılı Kanun kapsamı, MEB tip sözleşmesindeki hüküm) **doğrulanmalı** (H-04).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/format.js:48-50` (`invoiceStatus`) gecikmiş durumu türetir; kısmi ödeme ve bedel yok (bedelin olmaması doğru varsayılandır). Finans özeti `GET /api/v1/finance/overview` (core `financeOverview`; yönetici ve ön büro, modül `finance`; IST-116, IST-121): dönemin net tahsilatı ve ay kırılımı (iptal, iptal edildiği ayda düşer; vade kırılımı taksitin vade ayına göre), bugünün kurum geneli açık ve gecikmiş tutarı (`/finance/totals` ile aynı kural; kısmi ödemede yalnız kalan kısım) ve gecikmiş borcu olan öğrenciler (`overdueStudents`, en eski ödenmemiş vade ile; erken uyarı listesi bunu okur). Dönem verilmezse son altı takvim ayıdır.

### DOM-FIN-035 · Ödeme hatırlatması

- **Kural:** Ödeme hatırlatması hizmet iletisidir ve ticari ileti onayı gerektirmez (`DOM-KAY-004`). Ödeyiciye, bildirim tercihine ve sessiz saate uyularak gönderilir (`DOM-ILT`). Aynı taksit için günde en fazla bir hatırlatma gider. Her gönderim kanal, alıcı, zaman ve teslim sonucuyla kaydedilir. Hatırlatma metni tutar ve vade dışında öğrencinin akademik veya kişisel verisini içermez.
- **Gerekçe:** Hatırlatma kaydı tahsilat takibinin ve olası uyuşmazlığın kanıtıdır. Aşırı hatırlatma veli ilişkisini bozar.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (ölçülülük). Hatırlatmanın hizmet iletisi sayılması **doğrulanmalı** (H-21).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — uygulama içi kanal var (API): core `lib/installment-reminders.ts` karar verir (vadeye 3 gün kala ve vade günü `installment_due`, vade geçince `installment_overdue`; tam ödenmiş taksit gitmez, kısmi ödenmiş gider; gün Europe/Istanbul), türler `lib/finance-notifications.ts` (hizmet bildirimi, `finance` modülü, başlıkta tutar ve vade yok, `DOM-ILT-023`). Tarama `services/installment-reminders.ts`, iş `jobs/installment-reminders.ts` (`installments.remind`, her gün 09:00, sessiz saatte çalışmaz); `dedupeKey` taksit ve vade günüdür, iki pencere kesişmediği için aynı taksite aynı gün ikinci bildirim gitmez. Bir vade günü için en çok iki hatırlatma gider, gecikme tekrarlanmaz. İş `jobs/registry.ts`'e eklenmeden zamanlanmaz (`TODO(finans-bildirim-kayit)`). Alıcı `notify` kuralıdır: 18 yaş altında velayetli ve kısıtsız bütün veliler, yetişkinde kursiyer; kısıtlı veli görmez. Ödeyici veli velayeti olmasa da finans bildirimini görür (kullanıcı kararı K-04, 2026-11-03; `DOM-ILT-074`, ON-291): core `PAYER_NOTIFICATION_KINDS` okuma kapsamı ödediği öğrencinin finans türü veli bildirimini açar, velayetli ödeyici aynı bildirimi bir kez görür. Ödeyiciye daraltma yok: ödeyici olmayan velayetli veli de görür. Kurum metni, sıklık ayarı (IST-109), teslim sonucu, personele kişi bazında gönderim listesi, e-posta ve SMS yok. Çevrimdışı demo `apps/web/src/views/Finance.vue:89-95` yalnız `reminderAt` yazar.

## İade

### DOM-FIN-040 · Ayrılışta ücret iadesi

- **Kural:** İade, ayrılış tarihi (`DOM-KAY-024`) ve ücret birimine göre hesaplanır. Oranlar profil parametresidir.
  - **Yıllık ücret (`school`), öğretim yılı başlamadan ayrılış:** yıllık ücretin %10'u kesilir, kalanı iade edilir. Öğrenci sınavla öğrenci alan bir resmî okulun 9. sınıfına kayıt yaptırdığını belgelerse kesinti yapılmaz, tamamı iade edilir.
  - **Yıllık ücret, öğretim yılı başladıktan sonra ayrılış:** kesinti `yıllık ücret × %10 + yıllık ücret × (öğrenim görülen gün / öğretim yılı toplam günü)`, kalanı iade edilir.
  - **Ders saati ücreti (`language_school`, kurslar), dönem başlamadan ayrılış:** öğrenim ücretinin %10'u kesilir.
  - **Ders saati ücreti, dönem başladıktan sonra ayrılış:** kesinti `ücretin %10'u + öğrenim görülen ders saati × saat ücreti`.
  - Öğretim başladıktan sonra ayrılandan alınacak toplam tutar öğrenim ücretini aşamaz. Ödenen tutar hak edilenden azsa iade sıfırdır ve kalan borç `hak edilen − ödenen` olur.
  - Burslu öğrenciden okuduğu süre için ücret istenmez (`DOM-FIN-025`).
  - İade ayrılış tarihinden itibaren en geç bir ay içinde yapılır. Sistem bu süreyi takip eder ve süresi yaklaşan iadeleri yöneticiye listeler.
  - **Hesap tabanı:** "Yıllık ücret" olarak sözleşmenin indirim sonrası net ücreti alınır (veli lehine muhafazakâr yorum).
  - **Gün sayımı:** "Öğrenim görülen gün" MEB çalışma takviminin ders günleriyle sayılır. Profilde `refundDayBasis` parametresidir.
  - **Ek hizmetler:** Yemek, servis gibi ek hizmetler kullanılmayan süre oranında iade edilir.
- **Gerekçe:** İade mevzuatla belirlenmiş bir hesaptır; elle yapılırsa her ayrılışta uyuşmazlık doğar.
- **Kaynak:** ÖÖKY md. 56/3-a, b, c ve 56/4; md. 62/5. Net ücret tabanı (H-13), gün sayım esası (takvim günü mü, ders günü mü; H-14) ve ek hizmet iadesi (H-15) **doğrulanmalı**; mevzuat metni bunları açıkça belirtmez. Oranların güncel metni **doğrulanmalı** (H-12).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `lib/withdrawals.ts` (`quoteWithdrawal`), `POST /api/v1/students/:studentId/withdrawal-quote`; görülen ve toplam birim elle girilir, kesinti oranı sabittir (`REFUND_DEDUCTION_BASIS_POINTS`). Burslu ayrılışında öğrenim için ödenenden fazlası istenmez (`scholarshipExempt`, DOM-FIN-025; ödenenin normal hesabı aşan kısmı yine iade edilir, ek hizmet istisna dışıdır; yorum **doğrulanmalı**, H-16). Çalışma takvimi ve kurum profili yok (OG-269).

### DOM-FIN-041 · İade kaydı ve atomikliği

- **Kural:** İade ayrı bir kayıttır: hesap dökümü (girdi, profil sürümü, kesinti kalemleri), onaylayan yönetici, ödeme tarihi, hedef banka hesabı (IBAN, hesap sahibi ödeyici olmalı). Ayrılış onayı, açık taksitlerin iptali ve iade kaydının oluşması tek işlemde yazılır; biri başarısızsa hiçbiri yazılmaz. İade ödendikten sonra hesap değiştirilemez. Ayrılış hesabına giren (ayrılıştan önceki) tahsilat iptal edilemez, çünkü iade ya da kalan borç ona dayanır; ayrılışta kalan borç için açılan taksite sonradan alınan tahsilat `DOM-FIN-033` ile iptal edilebilir ve borç taksiti yeniden açılır.
- **Gerekçe:** Kısmi yazım, iade edilmiş ama hâlâ borçlu görünen veli üretir.
- **Kaynak:** İşletme kuralı; ADR 0001 (tek veritabanı işlemi).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `POST /api/v1/students/:studentId/withdraw` ve `POST /api/v1/withdrawals/:withdrawalId/pay-refund` (`student_withdrawals`, ADR 0006 karar 10). İade ödemesi aynı transaction'da `refund_paid` bildirimi yazar (IST-110): yalnız ayrılış kimliği, tutar, IBAN ve hesap sahibi yok; alıcı kuralı `DOM-FIN-035`'teki gibidir, ayrılan yetişkin kursiyere gider. Ayrılışın kendisi bildirim üretmez. Tahsilat iptali (`reversePayment`, `lib/payments.ts`) ayrılmış öğrencide yalnız bütünüyle borç taksitine dağıtılmış tahsilatı kabul eder; borç taksitinin kimliği ayrılış dökümünde saklanır (`breakdown.debtInvoiceId`), bu alanı olmayan eski kayıtta bütün tahsilatlar 409 `payment_student_withdrawn` alır (ON-108). İade ödemesinin `Idempotency-Key` kaydı (24 saat) maskeli IBAN ve hesap sahibini saklamaz; tekrar yanıtı bu alanları iade kaydından ekler (`services/withdrawals.ts`, ON-108).

### DOM-FIN-042 · Uzaktan satışta cayma hakkı

- **Kural:** `language_school` paketi tamamen çevrim içi (kurum binasına gelmeden) satılıyorsa satış mesafeli sözleşme sayılabilir. Bu durumda yasal cayma süresi ve iade sırası `DOM-FIN-040`'tan önce uygulanır. Doğrulanana kadar kurum bu kanalı açarsa cayma süresi sözleşmede belirtilir ve süresi içindeki ayrılışta kesinti yapılmaz.
- **Gerekçe:** Tüketici mevzuatı ile ÖÖKY iade kuralı çakışabilir; veli/kursiyer aleyhine yorum risklidir.
- **Kaynak:** 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği; süre, istisna ve ÖÖKY ile ilişki **doğrulanmalı** (H-17).
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Belgeler, yetki ve iz

### DOM-FIN-050 · Dekont

- **Kural:** Dekont yalnız tamamlanmış tahsilat için üretilir; her tahsilatın tek dekontu vardır. Dekont numarası kurum içinde yıl bazında ardışık ve benzersizdir. Aynı dekont yeniden üretildiğinde numara ve içerik değişmez. Dekont ödeyiciyi, öğrenciyi, tutarı (kuruş doğruluğunda), yöntemi, banka referansını ve ilgili taksitleri gösterir. Dekont kurum içi tahsilat belgesidir; fatura veya e-arşiv yerine geçmez. Fatura yükümlülüğü ayrı takip edilir.
- **Gerekçe:** Veli ödediğini kanıtlayabilmeli; ardışık numara eksik veya mükerrer belgeyi görünür kılar.
- **Kaynak:** İşletme kuralı. Eğitim hizmetinde fatura/e-arşiv zorunluluğu (M-01, M-02), KDV oranı (M-03) ve kartla ödemede dekontun yeterliliği (M-05) **doğrulanmalı**; sistem bu değerleri hesaplamaz.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — API tahsilata kurum ve yıl içinde ardışık numara verir (`receiptYear`, `receiptNumber`). Belge kodu (`lib/document-data.ts`) henüz taksit kimliğini kullanır.

### DOM-FIN-051 · Sözleşme ve ödeme planı belgesi

- **Kural:** Sözleşme ve taksit taahhüt belgesi onaylanmış sözleşme sürümünü ve onun taksitlerini gösterir (`DOM-FIN-012`). Belgedeki tutar ile sistemdeki net tutar aynı kaynaktan gelir. Ek protokol yeni belge sürümü üretir; eski sürüm erişilebilir kalır.
- **Gerekçe:** Veliye verilen belge ile sistemdeki borç ayrışmamalıdır.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 53/1. Taksit taahhütnamesi metninin hukuki uygunluğu **doğrulanmalı** (H-09).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/document-data.ts` sözleşme ve plan belgesini aynı kayıttan üretir. Sözleşme belgesi (`apps/web-react/src/lib/pdf/templates/contract.ts`) sürüm numarasını, durumu, imza yetkilisini ve ödeyici onayının biçimini ve zamanını yazar; onaylı sürümün Ek 1'i onay anının plan kopyasıdır, ek protokol taslağı önerilen planı (`Öneri`) gösterir (`contractPlanLines`, IST-092). Ek protokol gerekçesiyle ayrı belge sürümüdür; önceki sürüm kayıtta ve belgede değişmeden kalır, güncel planda olmayan satırı "Güncel planda yok" olarak gösterir. Burs ayrı satırdır; tam bursta Ek 1 taksitsizdir. Veli belge listesi sürümleri durumlarıyla (onaylıda onay biçimi ve günüyle) gösterir, iptal edilen ek protokolü göstermez (`pages/finance/FamilyFinancePages.tsx`); görevli paneli aynı planı ekranda da gösterir (`ContractParts.tsx` `ContractPlanTable`, `contractPlanRows`); kesin kayıt sonrası "Sözleşmeyi görüntüle" aynı belgeyi açar (`pages/crm/EnrollmentPage.tsx`). Yenileme sözleşmesi (ON-042, IST-100) Kayıt Yenileme ayrıntısındaki `Yeni dönem sözleşmesi` ile açılır ve aynı şablona yenilemenin plan anındaki kaydını ekler (`templates/renewal-contract.ts`, `pages/finance/RenewalContractPdfButton.tsx`): Ek 1 önceki sınıf → yeni sınıf ve dönemi, sınıf geçişinin ayrı işlem olduğunu yazar; Ek 2 ilan ücretini, tarife sürümünü, uygulanabilecek en yüksek ücreti, artış tavanının bazını ve kaynağını, yıl yıl ÜFE/TÜFE oranı ile ara tavanı (DOM-FIN-005), oranların bülten kaynağını (profilden; plandan sonra düzeltilen oran belirtilir, veli belgesinde genel cümle), indirim kaybı gerekçesini (DOM-FIN-023) ve bursu gösterir. Ücret kararı olmayan köprü yenilemesinde Ek 2 yoktur. Sözleşmeler sekmesinden açılan aynı sözleşme Ek 2'siz kalır (yenileme kaydını okumaz). Sözleşme metni örnektir; Bakanlık tip sözleşme metni yok. Taahhütname taahhüt cümlesi ve imza taşır (`templates/payment-plan.ts`); burslu öğrenciye sunulmaz (`hasScholarshipContract`, DOM-FIN-025), öğrenci rolüne açık değildir. Tahsil edilen ve kalan tutar bakiye ucundan gelir, kısmi ödeme sayılır (`collectedCents`).

### DOM-FIN-052 · Finans yetki ve kapsamı

- **Kural:** Kurum kimliği yalnız oturumdan gelir; başka kurumun finans kaydı görünmez. Ön büro tarife görür, sözleşme hazırlar ve tahsilat kaydeder. İndirim istisnası, tahsilat iptali, iade ve burs onayı yöneticidedir. Öğretmenin finans erişimi yoktur. Veli yalnız ödeyici olduğu sözleşmeleri ve kendi çocuklarının borçlarını görür; ödeyici veli velayeti olmasa da ödeyicisi olduğu öğrencinin finans bilgisini görür (kullanıcı kararı, 2026-11-03). Öğrenci kendi ödeme planını yalnız web'de geniş ekranda salt okur görür (Ödemelerim); telefonda (mobil uygulama ve dar web ekranı) öğrenci ödemeleri gösterilmez, öğrenci tahsilat ya da ödeme işlemi yapamaz. Yetişkin kursiyer kendi ödeyicisidir (`DOM-YTK`).
- **Gerekçe:** Mali veri hassastır; onay ile kayıt aynı kişide toplanmamalıdır.
- **Kaynak:** İşletme kuralı; KVKK md. 12 (veri güvenliği); ADR 0001 karar 4 ve 7.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tahsilat kaydı (`invoice.pay`) yalnız `yonetici` ve `onburo` rollerinde (`packages/school-core/src/lib/authorize.ts`, `WRITE_ACTION_ROLES`); veli tahsilat kaydedemez. Velinin bağlı çocuğu için çevrim içi ödemesi ayrı eylemdir (`invoice.payOnline`, `finance` modülü); ödeme sağlayıcısı onayı gerektirir (`PROVIDER_CONFIRMATION_ACTIONS`) ve sağlayıcı seçilene kadar hiçbir işlem çağırmaz (`TODO(payment-provider)`). Yenileme `yonetici` ve `onburo` rollerine açık (`packages/school-core/src/lib/school-workflows.ts`); iade/iptal onayı yok; yenileme okumasında veli kapsamı bağlı çocuklardır (ödeyici bağı yenilemeyi açmaz). Öğrenci faturaları core kapsamında kendi kayıtlarıdır (`lib/scope.ts`, `invoices`). React web Ödemelerim sayfası 650 px ve altında veriyi hiç okumadan bilgi metni gösterir (`apps/web-react/src/pages/finance/FamilyFinancePages.tsx`). Mobil uygulama sayfayı öğrenciye hiç açmaz (`apps/mobile/src/model/school.ts`, `hiddenOnMobile`). Öğrenci bakiyesi `GET /api/v1/finance/students/:studentId/balance` (core `studentBalance`): toplam, ödenen, açık ve gecikmiş tutar, gecikmiş taksit sayısı ve en yakın açık taksit; kısmi ödemede yalnız kalan kısım sayılır. Yönetici ve ön büro kurumun öğrencisini, veli velayetli ve iletişim kısıtı olmayan bağlı çocuğunu, öğrenci kendisini okur; kapsam dışı öğrenci 404, öğretmen 403. Ödeyici veli velayeti olmasa da ödeyicisi olduğu öğrencinin finansını okur (kullanıcı kararı K-04, 2026-11-03; `DOM-ILT-074`, ON-291): ödeyici bağı aktöre `payer` bağlantısıyla gelir (`scope.payerStudentIds`, OG-1002); core `ONUR_READ_RULES` `invoices` ve `contracts` kuralı `FINANCE_PERSONAL`/`ownOrPayerStudent` ile, bakiye, ekstre, tahsilat listesi ve ayrıntısı (dekont kaynağı) `financeStudentIds(scope)` ile açılır (`services/finance-exports.ts`, `services/payments.ts`). İletişim kısıtlı veli ödeyici olamaz ve finans okumaz; ödeyici bağı akademik, iletişim, rıza ve kayıt (yenileme, kayıt geçmişi) okumasını açmaz. Ödeyici velinin fatura satırında öğrenci adı boştur (öğrenci kaydını okuyamaz). Testler `tests/finance-payer-scope.test.ts`, `apps/api/test/finance-payer-scope.test.ts`.

### DOM-FIN-053 · Finans denetim izi

- **Kural:** Tarife, sözleşme, indirim, tahsilat, iptal, iade ve burs işlemlerinin her biri denetim izine yazılır: kim, ne zaman, eski değer, yeni değer, gerekçe. Finans denetim izi adet sınırıyla kesilmez, silinmez.
- **Gerekçe:** MEB denetimi ve veli uyuşmazlığında geriye dönük kanıt gerekir.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 53/2 (ücret tespitinin belgelendirilmesi).
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — denetim kaydı son 200 kayıtla kesilir (`packages/school-core/src/lib/school-workflows.js:1334`).

### DOM-FIN-055 · Muhasebe aktarım profili

- **Kural:** Kurum muhasebe dosyasının sütun adını, sırasını, ayırıcısını, tarih ve tutar biçimini ve sabit hesap kodlarını kendisi eşler. Profil yalnız biçimdir: satırlar ve toplamlar değişmez. Profil yoksa standart dosya iner. Yalnız yönetici düzenler.
- **Gerekçe:** Kurumlar farklı muhasebe programı kullanır; dosya bağlanan programa göre gelmelidir (IST-111).
- **Kaynak:** İşletme kuralı. Taksitli ücrette fatura zamanı **doğrulanmalı** (M-04).
- **Kurum türü:** ikisi
- **Kodda:** var — `lib/finance-export-profile.ts`, `GET`/`PATCH /api/v1/finance/export-profile`, `FinanceExportProfilePanel.tsx`. Programa özel hazır profil örnek dosya gelince eklenir; doğrudan API bağlantısı kapsam dışıdır.

### DOM-FIN-054 · Cari ekstre

- **Kural:** Öğrencinin ekstresi taksit borçlarını ve tahsilatları tarih sırasıyla, yürüyen bakiyeyle gösterir. Borç ve alacak toplamının farkı açık tutara eşittir. İptal edilen tahsilat silinmez, iptal gününe ters kayıt olarak yazılır. Taksite dağıtılmayan tutar iade alacağıdır, bakiyeyi düşürmez.
- **Gerekçe:** Veliye verilen ekstre taksit ve tahsilat kayıtlarıyla kuruşu kuruşuna tutmalıdır (IST-107).
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var (core ve API) — `lib/finance-statement.ts`, `GET /api/v1/finance/students/:studentId/statement`. Veli `/veli/finans` ve öğrenci `/ogrenci/odemelerim` ekranında hareketler ve PDF, kurum görevlisinde taksit panelinde PDF (`StudentStatementSection.tsx`, `templates/finance-statement.ts`). PDF önizlemede açılır; indirme ve yazdırma aynı PDF'yi kullanır (`PdfButton` `student-statement`).

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-FIN-001 | Kayıt tutarı tam TL, yenileme tutarı iki ondalık alır; iki giriş kuralı farklı (`packages/school-core/src/lib/domain.js:22-26`, `school-workflows.js:117-126`). |
| DOM-FIN-035 | Yalnız uygulama içi kanal, ödeyiciye daraltma yok; Vue demosu gerçek ileti göndermez (`apps/web/src/views/Finance.vue:89-95`).                                  |
| DOM-FIN-050 | Dekont numarası taksit kimliğidir; ardışık numara yok (`packages/school-core/src/lib/document-data.js:18`).                                                     |
| DOM-FIN-053 | Denetim izi 200 kayıtla kesilir (`packages/school-core/src/lib/school-workflows.js:1334`).                                                                      |
