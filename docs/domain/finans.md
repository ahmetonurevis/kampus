# Finans

Ücret ilanından sözleşmeye, taksit, indirim, burs, tahsilat, gecikme, iade ve belgelere kadar kurumun para akışı. Kayıt yaşam döngüsü [kayit-ve-crm.md](kayit-ve-crm.md), dil okulu paket ve saat satışı [dil-okulu.md](dil-okulu.md) içindedir.

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
- **Kaynak:** 5580 md. 13/1 (ocak–mayıs ilanı); ÖÖKY md. 54/1-a, c, ç, d ve 54/2.
- **Kurum türü:** ikisi (dil okulunda ders saati ücreti, `DOM-FIN-006`)
- **Kodda:** kısmen — tarife sürümü, ilan ve MEBBİS tarihi var (`lib/fee-tariffs.ts`, `POST /api/v1/fee-tariffs`, ADR 0006 karar 8). Kesin kayıt tutarı yayımlanmış tarifeden hesaplanır (`lib/enrollment.ts`). Yenileme de yayımlı tarife ister, ilanı aşamaz (API, `assertRenewalWithinTariff`); çevrimdışı demo tutarı serbesttir. İlan dönemi dışındaki yayımda yayım penceresi uyarır, engellemez (`isOutsideAnnouncementPeriod`). İlan tutarını aşan fiyat editörde girilirken uyarı verir (`tariffItemExceedsAnnounced`, IST-104), yayımda reddedilir (`tariff_amount_exceeds_announced`).

### DOM-FIN-003 · Ek hizmetler ayrı kalemdir ve isteğe bağlıdır

- **Kural:** Yemek, kahvaltı, servis, pansiyon, kitap-kırtasiye, kıyafet ve etüt gibi hizmetler tarifede öğrenim ücretinden ayrı kalem olarak ilan edilir. Bunlar ayrı borç kalemi açar ve yalnız veli talep ettiyse sözleşmeye eklenir. Öğrenim ücretine gömülemez, öğrenim ücretinin indirimini koşula bağlamak için zorunlu tutulamaz.
- **Gerekçe:** Mevzuat bu hizmetleri ayrı tespit ve ilan ettirir; hizmetten talep eden veli yararlanır.
- **Kaynak:** ÖÖKY md. 53/5, 54/1-a son cümle.
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — ek hizmet ayrı taksit kaydıdır (`feeKind`, `lib/enrollment.ts`). Yenileme henüz kalem ayırmaz.

### DOM-FIN-004 · İlan dışı ad altında tahsilat yok

- **Kural:** Sistem yalnız tarifede tanımlı kalem türleriyle borç açar. "Bağış", "yardım", "kayıt ücreti", "materyal katkısı", "staj/yaz uygulaması" gibi tarifede olmayan adlarla borç veya tahsilat kaydı oluşturulamaz. Serbest açıklamalı elle borç girişi yoktur; düzeltme yalnız mevcut kalemin ters kaydıyla yapılır (`DOM-FIN-033`).
- **Gerekçe:** Yönetmelik ilan edilenler dışında hiçbir ad altında ücret alınmasını yasaklar.
- **Kaynak:** ÖÖKY md. 54/1-b, 55/4.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tarife kalem türü sabit listedir (`FEE_ITEM_KINDS`, `lib/fee-tariffs.ts`). Taksitin kalem türü henüz yok.

### DOM-FIN-005 · Devam eden öğrenciye artış sınırı

- **Kural:** `school` ara sınıflarında yeni yıl öğrenim ücreti şu tavanı aşamaz: `baz × (1 + ((ÜFE_ort + TÜFE_ort) / 2 + ek_puan) / 100)`. Baz, ara sınıfa yeni gelen için önceki yıl ilan edilen ücret, okulda devam eden öğrenci için kayıt sözleşmesindeki ücrettir. Ders yılı içinde kayıt olanın sonraki yıl ücreti, kayıt yılının ilan ücreti üzerinden hesaplanır. ÜFE ve TÜFE önceki yılın ortalamalarıdır; değerler kaynağıyla birlikte (TÜİK bülteni, tarih) profile yıl bazında girilir. `ek_puan` bugün 5'tir. Yenileme planı tavanı aşan tutarla oluşturulamaz.
- **Gerekçe:** Mevcut veliyi sözleşme sonrası fahiş artıştan korur; MEB bu sınırı denetler.
- **Kaynak:** ÖÖKY md. 53/1 (RG 5/8/2023-32270 değişikliği).
- **Kurum türü:** `school`
- **Kodda:** kısmen — tavan hesabı core `tuitionIncreaseCeiling` (`lib/fee-tariffs.ts`, kuruş tamsayısı, tavan aşılmasın diye aşağı yuvarlanır). Uygulanmıyor: `renewalQuote` (`lib/school-workflows.ts`) önceki sözleşmeye bakmaz, ÜFE/TÜFE değerlerinin yıl bazında girileceği profil yok; yenileme API'siyle bağlanır (ON-030).

### DOM-FIN-006 · Ücret birimi kurum türüne göre

- **Kural:** `school` öğrenim ücretini **yıllık** tespit eder; taksitler yıllık ücretin bölümüdür. `language_school` öğrenim ücretini **ders saati ücreti** olarak tespit eder; paket fiyatı `saat × saat ücreti − ilanlı indirimler` ile türetilir ve iade bu saat ücretine göre hesaplanır (`DOM-FIN-040`). Paket kurgusu `DOM-DIL` içindedir.
- **Gerekçe:** İade ve indirim tabanı ücret birimine bağlıdır.
- **Kaynak:** ÖÖKY md. 55/1-a, c. Dil kursunun MEB lisanslı "özel öğretim kursu" olması varsayılmıştır; lisanssız (ticari) dil okulu için ÖÖKY uygulanmaz ve bu kurum için **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tarife yayımı öğrenim ücreti birimini kurum türüyle denetler (`planTariffPublish`). Paket yok; iade hesabı `quoteWithdrawal`'dadır.

## Sözleşme ve taksit

### DOM-FIN-010 · Sözleşme tarafları, içerik ve değişmezlik

- **Kural:** Her kesin kayıt ve yenileme için bir sözleşme oluşur. Sözleşmede Bakanlığın yayımladığı tip sözleşme sürümü, ödeyici (`DOM-KAY-012`), öğrenci, eğitim yılı, sınıf/program, tarife sürümü, brüt ücret, her indirim kalemi, net ücret, ek hizmetler ve taksit planı bulunur. Ödeyici onayı (imza veya elektronik onay) zamanıyla saklanır. Onaylanmış sözleşmenin tutarı ve planı değiştirilemez; değişiklik ek protokol olarak yeni sürümle yapılır ve eski sürüm salt okunur kalır.
- **Gerekçe:** Sözleşme sonraki yıl artış tabanıdır (`DOM-FIN-005`) ve iade hesabının girdisidir.
- **Kaynak:** ÖÖKY md. 53/1 (Bakanlıkça belirlenip yayımlanan özel sözleşme).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — sözleşme kesin kayıtta (`packages/school-core/src/lib/domain.js:160-166`) ve yenilemede (`school-workflows.js:832-841`) oluşur; ödeyici, tip sözleşme sürümü, indirim dökümü ve onay yok.

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
- **Kaynak:** ÖÖKY md. 54/1-a, d.
- **Kurum türü:** ikisi
- **Kodda:** yok.

## İndirim, burs ve ücretsiz okutma

### DOM-FIN-020 · İndirim yalnız ilanlı türden seçilir

- **Kural:** İndirim serbest tutar olarak girilmez. Tarifedeki türlerden (kardeş, peşin, erken kayıt, referans, kurumsal anlaşma, personel çocuğu vb.) seçilir. Her indirim kaleminin türü, oranı veya tutarı, koşulu ve onaylayan kişi sözleşmede saklanır. İndirim ilan ücreti üzerinden hesaplanır; zincirleme (indirimli tutara ikinci indirim) yoktur.
- **Gerekçe:** Mevzuat kurumca belirlenecek indirimlerin ilanda belirtilmesini ister. Serbest indirim ilan dışı uygulama ve kayıt dışı pazarlık riski taşır.
- **Kaynak:** ÖÖKY md. 54/1-a.
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — `priceEnrollment` (`lib/enrollment.ts`). Yenilemede indirim henüz serbest tutardır (`lib/school-workflows.ts`).

### DOM-FIN-021 · Toplam indirim tavanı

- **Kural:** Bir sözleşmedeki indirimlerin toplamı ilan edilen öğrenim ücretinin %50'sini aşamaz. Tavanın oranı profil parametresidir. Tavanın tek istisnası, aynı kurucuya ait kurumlarda görev yapan personelin çocuğudur; bu istisna personel kaydına bağlanır ve ayrıca onaylanır. Tavan aşılırsa sözleşme oluşturulmaz ve hangi kalemin aşırdığı gösterilir. Burs (`DOM-FIN-025`) ve ücretsiz okutma (`DOM-FIN-026`) indirim değildir, ayrı kayıt türüdür. Burs adıyla tavanı aşan indirim verilmesini önlemek için burs yalnız tanımlı burs programından atanır.
- **Gerekçe:** Mevzuat indirim oranını sınırlar; sınırsız indirim haksız rekabet ve ilanın anlamsızlaşması demektir.
- **Kaynak:** ÖÖKY md. 54/1-a. Burs ve ücretsiz okutmanın %50 tavanına dahil olmadığı yorumu ÖÖKY md. 62/4'e (burslu oranı ücretsiz oranının dışında tutulur) ve bursun ayrı bölümde düzenlenmesine dayanır; **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** var (API, kesin kayıt) — `DISCOUNT_CAP_BASIS_POINTS`, 422 `discount_cap_exceeded`; personel çocuğu istisnası yönetici onayıyla. Personel kaydına bağlama ve yenileme henüz yok. Burs (`DOM-FIN-025`) tavan hesabına girmez.

### DOM-FIN-022 · Kardeş indirimi

- **Kural:** Kardeş indirimi, aynı kurumda aynı veliye bağlı (`DOM-KAY-013`) ve aynı eğitim yılında aktif kaydı olan ikinci ve sonraki çocuğa uygulanır. Hangi çocuğun "ikinci" sayılacağı tarifede tanımlıdır (varsayılan: düşük ücretli olan). Kardeş bağı ön büro önerisi ve onayıyla kurulur, otomatik kurulmaz.
- **Gerekçe:** Kardeş indirimi aile bağına dayanır; bağ yanlış kurulursa indirim haksız uygulanır.
- **Kaynak:** İşletme kuralı; ilan zorunluluğu ÖÖKY md. 54/1-a.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — aynı veliye bağlı aktif kardeş denetlenir (`enrollProspectWithTariff`). "İkinci çocuk" seçimi ve yıl denetimi yok.

### DOM-FIN-023 · İndirim koşulu kalkınca

- **Kural:** Kardeşin ayrılması gibi nedenlerle indirim koşulu ortadan kalkarsa cari yıl sözleşmesi değişmez. Bir sonraki yılın ücreti, öğrencinin kayıt olduğu yıldaki **indirimsiz** ücrete her öğrenim yılı için `DOM-FIN-005` oranı uygulanarak bulunur. Sistem yenileme planında bunu gerekçesiyle gösterir.
- **Gerekçe:** Mevzuat indirim şartı kalkan öğrencinin sonraki yıl ücretinin nasıl bulunacağını ayrıca düzenler.
- **Kaynak:** ÖÖKY md. 53/1 son cümle. Cari yıl sözleşmesinin korunması işletme kuralıdır.
- **Kurum türü:** `school`
- **Kodda:** kısmen — hesap core `tuitionAfterDiscountLoss` (`lib/fee-tariffs.ts`). Yenileme planında gerekçesiyle gösterim ve koşulun kalktığının tespiti yok (ON-030).

### DOM-FIN-024 · Referans indirimi

- **Kural:**
  - Referans indirimi yalnız o yılın tarifesinde ilan edilmiş bir indirim türüyse uygulanır.
  - Hak, referans veren veli/öğrenci adayın kaynağına bağlandıysa (`DOM-KAY-007`) ve referansla gelen aday kesin kayıt yapıp ilk taksitini ödediyse doğar.
  - Hak, referans verenin **açık veya bir sonraki sözleşmesine** indirim kalemi olarak eklenir. Nakit ödeme, hediye çeki veya borçtan bağımsız para iadesi yapılmaz.
  - Kalem `DOM-FIN-021` tavanına dahildir; tavanı aşan kısım düşer ve devretmez.
  - Bir aday yalnız bir referansa bağlanır. Kişi kendi çocuğu için referans olamaz; kardeş kaydı kardeş indirimidir (`DOM-FIN-022`).
  - Referansla gelen kayıt `DOM-FIN-040` kapsamında öğretim başlamadan iade alırsa, kullanılmamış referans hakkı iptal edilir. Kullanılmış hak geri istenmez.
- **Gerekçe:** Referans pazarlama aracıdır ama ilan dışı indirim veya kayıt dışı ödeme kanalına dönüşmemelidir.
- **Kaynak:** İşletme kuralı; ilan ve tavan ÖÖKY md. 54/1-a. Referans karşılığı nakit ödemenin ayrıca vergi ve ticari ileti yükümlülüğü doğurabileceği **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-FIN-025 · Burs programı

- **Kural:** Burs, kurumun eğitim yılı için tanımladığı burs programından atanır. Programda şart, miktar veya oran, süre, burslu sayısı ve kesilme koşulları bulunur. Programın il millî eğitim müdürlüğüne bildirildiği tarih kaydedilir; bildirilmemiş program kullanılamaz. Burs sınavı ücretsizdir; tarihi profil penceresinde olmalıdır (bugün ocak–mart) ve valilik izni kaydı gerekir. Bursluya burs belgeleri dışında maddi yükümlülük doğuran belge (senet, taahhüt) düzenlenmez. Kurumdan ayrılan burslu öğrenciden okuduğu süre için ücret istenmez. Gerçek dışı beyanla alınmış burs iptal edilir; burslu dönem ücretleri kanuni faiziyle geri istenir. Burs ataması MEBBİS'e işlendi olarak işaretlenir.
- **Gerekçe:** Burs mevzuatta indirimden ayrı, bildirime ve sınav kurallarına bağlı bir kurumdur.
- **Kaynak:** 5580 md. 13/5; ÖÖKY md. 58/4, 62, 63/3.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — program ve atama core `lib/finance-scholarships.ts`, tablolar `scholarship_programs` ve `scholarship_awards` (migration `0032`, öğrenci başına yılda tek atama kısmi benzersiz indeksle). API `GET/POST /api/v1/finance/scholarship-programs`, `POST …/:programId/notify` (bildirim günü bir kez, gelecek gün 422), `GET /api/v1/finance/scholarship-awards`, `POST …/:awardId/mebbis-record`; yazma yalnız yönetici (`scholarship.manage`), okuma yönetici ve ön büro. Atama kesin kayıtta yapılır (`scholarshipProgramId`, `enrollProspectWithTariff`): yalnız yönetici (422 `scholarship_approval_required`), bildirilmemiş program 422 `scholarship_program_not_notified`, dolu kontenjan 409 `scholarship_capacity_full` (kurum kilidi altında sayılır). Oran ilan ücretinden hesaplanır, indirimlerden sonra kalan neti aşamaz; sözleşmeye `scholarship` kalemi yazılır, tam bursta öğrenim taksiti açılmaz. Yok: burs sınavı ve valilik izni (ON-136), kesilme ve geri isteme (ON-283), kayıtlı öğrenciye sonradan atama, ayrılışta burslu istisnası (ON-023), yenilemedeki serbest burs yüzdesinin programa bağlanması (ON-030). Ekran: Finans sayfasında "Burslar" sekmesi (`?gorunum=burs`; ön büro yalnız görür) ve kesin kayıt formunun ücret adımında yalnız yöneticiye açılan burs seçimi, önizlemede burs kalemi.

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
- **Kodda:** kısmen — API `POST /api/v1/payments` ayrı kayıt, kısmi ödeme ve mahsup yapar (`lib/payments.ts`, ADR 0006). Taksitin `paidAt` alanı geçiş önbelleğidir; liste durumu henüz `Kısmi` üretmez, kısmi tutar `GET /api/v1/payments` dağılımından okunur. Çevrimdışı demo `payInvoice` ile tam ödeme işaretler.

### DOM-FIN-031 · Mükerrer tahsilat engeli

- **Kural:** Aynı ödeme iki kez işlenmez. Her tahsilat isteği bir idempotency anahtarı taşır; aynı anahtarla gelen ikinci istek yeni kayıt açmaz, ilk sonucu döndürür. Banka veya POS işlem referansı kurum içinde benzersizdir. Ödenmiş taksite ek tahsilat kaydedilmez. Tahsilat ile taksit durumu tek veritabanı işleminde yazılır. POS geri çağrısı tekrar gelirse yine ilk sonuç döner.
- **Gerekçe:** Çift tıklama, ağ yeniden denemesi ve POS tekrar bildirimleri en sık mükerrer ödeme nedenidir.
- **Kaynak:** İşletme kuralı; ADR 0001 (atomik yazım, sunucuda kural).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `Idempotency-Key` zorunlu, referans kurum içinde benzersiz (`payments_reference_key`, iptal edilenler hariç), yazım tek transaction'da. Çevrimdışı demo çevrim içi ödemede sabit `'Demo Sanal POS'` yazar (`apps/web/src/views/Finance.vue`).

### DOM-FIN-032 · Tahsilat kanalı banka hesabıdır

- **Kural:** Öğrenim ücreti, kurum adına açılmış ve Bakanlığa/valiliğe bildirilmiş banka hesabına havale/EFT ya da o hesaba bağlı POS ile tahsil edilir. Kurum ayarında bildirilmiş hesaplar tutulur; tahsilat bu hesaplardan birine bağlanır. Nakit tahsilat kurum ayarıdır (`cash_payments_enabled`), varsayılan kapalıdır ve yalnız yönetici açar (ADR 0006 karar 7, proje sahibinin kararı). ÖÖKY md. 55/3 ile uyumu **doğrulanmalı**; açmanın sorumluluğu kurumdadır. Tahsilatlar MEBBİS modülüne işlendi olarak işaretlenir.
- **Gerekçe:** Mevzuat eğitim ücretinin bildirilmiş banka hesabına yatırılarak tahsilini ve MEBBİS'e işlenmesini ister.
- **Kaynak:** ÖÖKY md. 55/3.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — API nakdi kurum ayarıyla denetler (`lib/payments.ts`, 422 `cash_payment_disabled`; `PATCH /api/v1/payment-settings`). Bildirilmiş hesaplar `/api/v1/bank-accounts` ile tutulur; hesap tanımlıysa nakit dışı tahsilat bir hesaba bağlanır (422 `bank_account_required`), hiç hesap tanımlanmadıysa tahsilat engellenmez. Senet (`Senet`, IST-106) banka kanalından geçmediği için hesaba bağlanmaz, referansı senet numarasıdır; burslu öğrenciden alınmaz (`scholarship_promissory_note`, DOM-FIN-025). MEBBİS işareti `POST /api/v1/payments/:paymentId/mebbis-record` ile elle tutulur; MEBBİS'e bağlantı yoktur. Çevrimdışı demo formu ayarı bilmez (`apps/web/src/views/Finance.vue`).

### DOM-FIN-033 · Tahsilat silinmez, ters kayıtla düzeltilir

- **Kural:** Yanlış tahsilat silinmez ve tutarı değiştirilmez. Gerekçeli bir ters kayıtla iptal edilir, gerekirse doğru tahsilat yeniden girilir. İptal yetkisi yöneticidedir. İptal edilen tahsilatın dekontu "İptal edildi" ibaresiyle erişilebilir kalır.
- **Gerekçe:** Mali kayıt değiştirilirse mutabakat ve denetim imkânsızlaşır.
- **Kaynak:** İşletme kuralı. Ticari defter ve belge saklama süresi (VUK) **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `POST /api/v1/payments/:paymentId/reverse` (yalnız `yonetici`, gerekçe ve `If-Match` zorunlu). `İptal edildi` ibareli dekont belgesi henüz yok.

### DOM-FIN-034 · Gecikme durumu ve gecikme bedeli

- **Kural:** Vadesi (Europe/Istanbul takvim günü) geçmiş ve tam ödenmemiş taksit `Gecikmiş` sayılır. Gecikme gün sayısı vade gününden sonraki ilk günden başlar. Gecikme faizi veya cezası yalnız onaylı sözleşmede açıkça yazılıysa ve oranı profilde tanımlı yasal tavanı aşmıyorsa hesaplanır. Varsayılan kapalıdır. Gecikme bedeli ayrı kalemdir, öğrenim ücretine eklenmez. Borç, akademik kayıtlara erişimi engellemez (`DOM-KAY-025`).
- **Gerekçe:** Yasal dayanağı ve tavanı doğrulanmamış bir bedel otomatik uygulanırsa ilan dışı tahsilat sayılabilir (`DOM-FIN-004`).
- **Kaynak:** Gecikme durumu işletme kuralı. Gecikme faizinin dayanağı (TBK temerrüt hükümleri, 6502 sayılı Kanun kapsamı, MEB tip sözleşmesindeki hüküm) **doğrulanmamış**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/format.js:48-50` (`invoiceStatus`) gecikmiş durumu türetir; kısmi ödeme ve bedel yok (bedelin olmaması doğru varsayılandır). Finans özeti `GET /api/v1/finance/overview` (core `financeOverview`; yönetici ve ön büro, modül `finance`; IST-116, IST-121): dönemin net tahsilatı ve ay kırılımı (iptal, iptal edildiği ayda düşer; vade kırılımı taksitin vade ayına göre), bugünün kurum geneli açık ve gecikmiş tutarı (`/finance/totals` ile aynı kural; kısmi ödemede yalnız kalan kısım) ve gecikmiş borcu olan öğrenciler (`overdueStudents`, en eski ödenmemiş vade ile; erken uyarı listesi bunu okur). Dönem verilmezse son altı takvim ayıdır.

### DOM-FIN-035 · Ödeme hatırlatması

- **Kural:** Ödeme hatırlatması hizmet iletisidir ve ticari ileti onayı gerektirmez (`DOM-KAY-004`). Ödeyiciye, bildirim tercihine ve sessiz saate uyularak gönderilir (`DOM-ILT`). Aynı taksit için günde en fazla bir hatırlatma gider. Her gönderim kanal, alıcı, zaman ve teslim sonucuyla kaydedilir. Hatırlatma metni tutar ve vade dışında öğrencinin akademik veya kişisel verisini içermez.
- **Gerekçe:** Hatırlatma kaydı tahsilat takibinin ve olası uyuşmazlığın kanıtıdır. Aşırı hatırlatma veli ilişkisini bozar.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (ölçülülük).
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — `apps/web/src/views/Finance.vue:89-95` yalnız `reminderAt` yazar ve "gerçek mesaj gönderilmedi" der; gönderim ve sıklık sınırı yok.

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
- **Kaynak:** ÖÖKY md. 56/3-a, b, c ve 56/4; md. 62/5. Net ücret tabanı, gün sayım esası (takvim günü mü, ders günü mü) ve ek hizmet iadesi **doğrulanmamış**; mevzuat metni bunları açıkça belirtmez.
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `lib/withdrawals.ts` (`quoteWithdrawal`), `POST /api/v1/students/:studentId/withdrawal-quote`; görülen ve toplam birim elle girilir, kesinti oranı sabittir (`REFUND_DEDUCTION_BASIS_POINTS`). Burslu istisnası, çalışma takvimi ve kurum profili yok.

### DOM-FIN-041 · İade kaydı ve atomikliği

- **Kural:** İade ayrı bir kayıttır: hesap dökümü (girdi, profil sürümü, kesinti kalemleri), onaylayan yönetici, ödeme tarihi, hedef banka hesabı (IBAN, hesap sahibi ödeyici olmalı). Ayrılış onayı, açık taksitlerin iptali ve iade kaydının oluşması tek işlemde yazılır; biri başarısızsa hiçbiri yazılmaz. İade ödendikten sonra hesap değiştirilemez.
- **Gerekçe:** Kısmi yazım, iade edilmiş ama hâlâ borçlu görünen veli üretir.
- **Kaynak:** İşletme kuralı; ADR 0001 (tek veritabanı işlemi).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `POST /api/v1/students/:studentId/withdraw` ve `POST /api/v1/withdrawals/:withdrawalId/pay-refund` (`student_withdrawals`, ADR 0006 karar 10).

### DOM-FIN-042 · Uzaktan satışta cayma hakkı

- **Kural:** `language_school` paketi tamamen çevrim içi (kurum binasına gelmeden) satılıyorsa satış mesafeli sözleşme sayılabilir. Bu durumda yasal cayma süresi ve iade sırası `DOM-FIN-040`'tan önce uygulanır. Doğrulanana kadar kurum bu kanalı açarsa cayma süresi sözleşmede belirtilir ve süresi içindeki ayrılışta kesinti yapılmaz.
- **Gerekçe:** Tüketici mevzuatı ile ÖÖKY iade kuralı çakışabilir; veli/kursiyer aleyhine yorum risklidir.
- **Kaynak:** 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği; süre, istisna ve ÖÖKY ile ilişki **doğrulanmamış**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Belgeler, yetki ve iz

### DOM-FIN-050 · Dekont

- **Kural:** Dekont yalnız tamamlanmış tahsilat için üretilir; her tahsilatın tek dekontu vardır. Dekont numarası kurum içinde yıl bazında ardışık ve benzersizdir. Aynı dekont yeniden üretildiğinde numara ve içerik değişmez. Dekont ödeyiciyi, öğrenciyi, tutarı (kuruş doğruluğunda), yöntemi, banka referansını ve ilgili taksitleri gösterir. Dekont kurum içi tahsilat belgesidir; fatura veya e-arşiv yerine geçmez. Fatura yükümlülüğü ayrı takip edilir.
- **Gerekçe:** Veli ödediğini kanıtlayabilmeli; ardışık numara eksik veya mükerrer belgeyi görünür kılar.
- **Kaynak:** İşletme kuralı. Eğitim hizmetinde fatura/e-arşiv zorunluluğu ve KDV oranı **doğrulanmamış**; sistem bu değerleri hesaplamaz.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — API tahsilata kurum ve yıl içinde ardışık numara verir (`receiptYear`, `receiptNumber`). Belge kodu (`lib/document-data.ts`) henüz taksit kimliğini kullanır.

### DOM-FIN-051 · Sözleşme ve ödeme planı belgesi

- **Kural:** Sözleşme ve taksit taahhüt belgesi onaylanmış sözleşme sürümünü ve onun taksitlerini gösterir (`DOM-FIN-012`). Belgedeki tutar ile sistemdeki net tutar aynı kaynaktan gelir. Ek protokol yeni belge sürümü üretir; eski sürüm erişilebilir kalır.
- **Gerekçe:** Veliye verilen belge ile sistemdeki borç ayrışmamalıdır.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 53/1.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/document-data.ts` sözleşme ve plan belgesini aynı kayıttan üretir; sürüm yok. Taahhütname taahhüt cümlesi ve imza taşır (`templates/payment-plan.ts`); burslu öğrenciye sunulmaz (`hasScholarshipContract`, DOM-FIN-025), öğrenci rolüne açık değildir. Kısmi ödeme tutarı şablona `collectedCents` ile verilir; web bağlantısı #19'da beklemektedir.

### DOM-FIN-052 · Finans yetki ve kapsamı

- **Kural:** Kurum kimliği yalnız oturumdan gelir; başka kurumun finans kaydı görünmez. Ön büro tarife görür, sözleşme hazırlar ve tahsilat kaydeder. İndirim istisnası, tahsilat iptali, iade ve burs onayı yöneticidedir. Öğretmenin finans erişimi yoktur. Veli yalnız ödeyici olduğu sözleşmeleri ve kendi çocuklarının borçlarını görür. Öğrenci kendi ödeme planını yalnız web'de geniş ekranda salt okur görür (Ödemelerim); telefonda (mobil uygulama ve dar web ekranı) öğrenci ödemeleri gösterilmez, öğrenci tahsilat ya da ödeme işlemi yapamaz. Yetişkin kursiyer kendi ödeyicisidir (`DOM-YTK`).
- **Gerekçe:** Mali veri hassastır; onay ile kayıt aynı kişide toplanmamalıdır.
- **Kaynak:** İşletme kuralı; KVKK md. 12 (veri güvenliği); ADR 0001 karar 4 ve 7.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — tahsilat kaydı (`invoice.pay`) yalnız `yonetici` ve `onburo` rollerinde (`packages/school-core/src/lib/authorize.ts`, `WRITE_ACTION_ROLES`); veli tahsilat kaydedemez. Velinin bağlı çocuğu için çevrim içi ödemesi ayrı eylemdir (`invoice.payOnline`, `finance` modülü); ödeme sağlayıcısı onayı gerektirir (`PROVIDER_CONFIRMATION_ACTIONS`) ve sağlayıcı seçilene kadar hiçbir işlem çağırmaz (`TODO(payment-provider)`). Yenileme `yonetici` ve `onburo` rollerine açık (`packages/school-core/src/lib/school-workflows.ts`); iade/iptal onayı ve ödeyici (sözleşme) kapsamı yok, veli kapsamı bağlı çocuklardır. Öğrenci faturaları core kapsamında kendi kayıtlarıdır (`lib/scope.ts`, `invoices`). React web Ödemelerim sayfası 650 px ve altında veriyi hiç okumadan bilgi metni gösterir (`apps/web-react/src/pages/finance/FamilyFinancePages.tsx`). Mobil uygulama sayfayı öğrenciye hiç açmaz (`apps/mobile/src/model/school.ts`, `hiddenOnMobile`). Öğrenci bakiyesi `GET /api/v1/finance/students/:studentId/balance` (core `studentBalance`): toplam, ödenen, açık ve gecikmiş tutar, gecikmiş taksit sayısı ve en yakın açık taksit; kısmi ödemede yalnız kalan kısım sayılır. Yönetici ve ön büro kurumun öğrencisini, veli velayetli ve iletişim kısıtı olmayan bağlı çocuğunu, öğrenci kendisini okur; kapsam dışı öğrenci 404, öğretmen 403.

### DOM-FIN-053 · Finans denetim izi

- **Kural:** Tarife, sözleşme, indirim, tahsilat, iptal, iade ve burs işlemlerinin her biri denetim izine yazılır: kim, ne zaman, eski değer, yeni değer, gerekçe. Finans denetim izi adet sınırıyla kesilmez, silinmez.
- **Gerekçe:** MEB denetimi ve veli uyuşmazlığında geriye dönük kanıt gerekir.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 53/2 (ücret tespitinin belgelendirilmesi).
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — denetim kaydı son 200 kayıtla kesilir (`packages/school-core/src/lib/school-workflows.js:1334`).

### DOM-FIN-054 · Cari ekstre

- **Kural:** Öğrencinin ekstresi taksit borçlarını ve tahsilatları tarih sırasıyla, yürüyen bakiyeyle gösterir. Borç ve alacak toplamının farkı açık tutara eşittir. İptal edilen tahsilat silinmez, iptal gününe ters kayıt olarak yazılır. Taksite dağıtılmayan tutar iade alacağıdır, bakiyeyi düşürmez.
- **Gerekçe:** Veliye verilen ekstre taksit ve tahsilat kayıtlarıyla kuruşu kuruşuna tutmalıdır (IST-107).
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var (core ve API) — `lib/finance-statement.ts`, `GET /api/v1/finance/students/:studentId/statement`. Veli `/veli/finans` ve öğrenci `/ogrenci/odemelerim` ekranında hareketler ve PDF, kurum görevlisinde taksit panelinde PDF (`StudentStatementSection.tsx`, `templates/finance-statement.ts`). PDF önizlemesi #20'de beklemektedir, belge doğrudan iner.

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-FIN-001 | Kayıt tutarı tam TL, yenileme tutarı iki ondalık alır; iki giriş kuralı farklı (`packages/school-core/src/lib/domain.js:22-26`, `school-workflows.js:117-126`). |
| DOM-FIN-005 | Yenilemede ÜFE/TÜFE+5 artış tavanı denetlenmez (`packages/school-core/src/lib/school-workflows.js:435-450`).                                                    |
| DOM-FIN-035 | Hatırlatma gerçek ileti göndermez, sıklık sınırı yok (`apps/web/src/views/Finance.vue:89-95`).                                                                  |
| DOM-FIN-050 | Dekont numarası taksit kimliğidir; ardışık numara yok (`packages/school-core/src/lib/document-data.js:18`).                                                     |
| DOM-FIN-053 | Denetim izi 200 kayıtla kesilir (`packages/school-core/src/lib/school-workflows.js:1334`).                                                                      |
