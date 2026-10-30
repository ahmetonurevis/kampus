# Kayıt ve CRM

Aday (lead) yakalamadan kesin kayda, yenilemeye ve ayrılışa kadar öğrenci/kursiyer yaşam döngüsü. Finansal sonuçlar [finans.md](finans.md), dil okuluna özgü seviye tespiti ve paketler [dil-okulu.md](dil-okulu.md) içindedir.

## Aday yaşam döngüsü

Aşamalar: `Yeni aday → İletişime geçildi → Görüşme planlandı → Teklif verildi → Kayıt oldu | Vazgeçti`. Dil okulunda `Görüşme planlandı` yerine `Seviye tespiti / deneme dersi planlandı` kullanılır.

### DOM-KAY-001 · Aday bir kişidir, kayıt bir sözleşmedir

- **Kural:** Aday kaydı öğrenci kaydı değildir; aday hiçbir akademik veya finansal kayıt üretmez. Öğrenci/kursiyer, sözleşme ve taksit planı yalnız "kesin kayıt" işleminde, tek atomik işlemde oluşur.
- **Gerekçe:** Satış hunisindeki kişi silinebilir/anonimleştirilebilir olmalı; öğrenci kaydı ise yasal saklama süresine tabidir.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (amaçla sınırlılık).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/domain.js:105-171` (`enrollProspect` öğrenci, veli, taksit ve sözleşmeyi birlikte yazar).

### DOM-KAY-002 · Aday tekilliği

- **Kural:** Aynı kurumda aynı normalleştirilmiş telefon veya e-posta ile açık (Kayıt oldu/Vazgeçti dışı) ikinci aday açılamaz; mevcut aday kartına yeni temas (not) eklenir. Kardeş adaylar aynı veli telefonunu paylaşabilir; bu durumda tekillik anahtarı `telefon + aday adı` olur.
- **Gerekçe:** Mükerrer aday, mükerrer arama ve yanlış dönüşüm oranı üretir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** yok — `apps/web/src/views/Crm.vue:139-158` mükerrer denetimi yapmaz.

### DOM-KAY-003 · Aday iletişim verisi ve aydınlatma

- **Kural:** Aday formu kaydedilirken aydınlatma metninin gösterildiği (sürüm + zaman) saklanır. Aday veli adına giriliyorsa veli iletişim bilgisi tutulur, çocuğun verisi en aza indirilir (ad, hedef düzey/seviye, ilgi alanı).
- **Gerekçe:** Aydınlatma yükümlülüğü veri toplanırken yerine getirilir; ispat yükü veri sorumlusundadır.
- **Kaynak:** KVKK md. 10.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KAY-004 · Pazarlama iletisi onayı

- **Kural:** Adaya kampanya, indirim, bursluluk sınavı duyurusu gibi tanıtım amaçlı SMS/e-posta/arama yalnız ticari elektronik ileti onayı varsa gönderilir; onay kanal bazında (SMS, e-posta, arama) ve ret hakkıyla saklanır. Randevu teyidi, sözleşme ve tahsilat bilgilendirmesi gibi hizmet iletileri onaya bağlı değildir.
- **Gerekçe:** Onaysız ticari ileti idari para cezası doğurur; İYS kaydı gerekir.
- **Kaynak:** 6563 sayılı Kanun md. 6 ve İYS düzenlemeleri — **doğrulanmalı** (eşik ve İYS kapsamı).
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KAY-005 · Aşama geçişleri

- **Kural:** `Kayıt oldu` aşamasına yalnız kesin kayıt işlemi geçirir; elle seçilemez. `Kayıt oldu` olan adayın aşaması değişmez. `Vazgeçti` seçilirken neden (fiyat, ulaşım, başka okul, akademik uygunsuzluk, diğer) zorunludur.
- **Gerekçe:** Dönüşüm raporu kayıtla tutarlı olmalı; kayıp nedeni satış stratejisinin girdisidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `apps/web/src/views/Crm.vue:174-186` (Kayıt oldu seçimi kayıt ekranına yönlendirir, kayıtlı adayın aşaması kilitli); vazgeçme nedeni yok.

### DOM-KAY-006 · Tanışma görüşmesi / deneme dersi çakışması

- **Kural:** Tanışma görüşmesi gelecek tarihli olur ve aynı kampüste aynı görevli/oda için zaman aralığı çakışamaz (tam saat eşitliği yetmez, süre dikkate alınır). Görüşme planlanınca aday `Görüşme planlandı` olur; görüşme yapılmadan aday `Teklif verildi` aşamasına geçebilir.
- **Gerekçe:** Ön büro kapasitesi sınırlıdır; yalnız başlangıç saati karşılaştırması 10:00–10:45 ile 10:30'u çakıştırmaz.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi (dil okulunda deneme dersi için bkz. `DOM-DIL-030`)
- **Kodda:** çelişiyor — `apps/web/src/views/Crm.vue:198-203` yalnız aynı kampüs ve birebir aynı başlangıç zamanını engeller; süre ve görevli yok.

### DOM-KAY-007 · Kaynak (lead source) zorunlu

- **Kural:** Her adayın kaynağı (web, veli referansı, kampüs ziyareti, telefon, bursluluk sınavı, sosyal medya, kurumsal anlaşma) zorunludur ve kayıttan sonra değiştirilemez. Veli referansı seçilirse referans veren öğrenci/veli bağlanır (referans indirimi için bkz. `DOM-FIN-024`).
- **Gerekçe:** Pazarlama bütçesi kaynak bazlı dönüşümle ölçülür.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/domain.js:17` (zorunlu serbest metin); sabit liste ve referans bağı yok.

### DOM-KAY-008 · Aday saklama ve imha

- **Kural:** `Vazgeçti` aşamasındaki veya 12 ay temas görmeyen aday kayıtları, pazarlama onayı yoksa en geç bir sonraki periyodik imha döneminde anonimleştirilir; dönüşüm istatistiği için yalnız kaynak, aşama ve tarih kalır.
- **Gerekçe:** Kişisel veri işleme amacı ortadan kalkınca silinir/anonimleştirilir.
- **Kaynak:** KVKK md. 7; Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hâle Getirilmesi Hakkında Yönetmelik (periyodik imha süresi en fazla 6 ay) — **doğrulanmalı**. 12 ay işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KAY-009 · Aday kaydının asgari alanları

- **Kural:** Aday ad, kampüs, ilgi (hedef düzey/seviye, program), kaynak (`DOM-KAY-007`), telefon ve gösterilen aydınlatma metninin sürümüyle açılır; e-posta isteğe bağlıdır. T.C. kimlik no, doğum tarihi, adres, okul notu gibi veriler aday aşamasında alınmaz; kesin kayıtta istenir (`DOM-KAY-012`). 18 yaş altı adayda telefon ve e-posta velinindir ve veli adı zorunludur; yetişkin adayda veli verisi saklanmaz. `school` adayı her zaman 18 yaş altı sayılır; `language_school`'da adayın 18 yaş altı olup olmadığı açıkça seçilir, seçimi olmayan eski kayıt 18 yaş altı sayılır. Ticari ileti onayı (`DOM-KAY-004`) kanal bazında, varsayılan "onay yok" olarak kaydedilir; e-postası olmayan adaya e-posta onayı yazılmaz.
- **Gerekçe:** Aday satış hunisindedir; amaçla sınırlı ve ölçülü veri dışında veri işlemek gereksiz risk doğurur. Veli kuralı yaş bilinmeden uygulanamayacağı için bilinmeyen yaş en korumalı biçimde yorumlanır.
- **Kaynak:** KVKK md. 4/2-ç (amaçla bağlantılı, sınırlı ve ölçülü işleme), md. 10 (aydınlatma); 6563 sayılı Kanun md. 6 — **doğrulanmalı** (bkz. `DOM-KAY-004`).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`createProspectSchema`, `createProspect`).

## Kesin kayıt

### DOM-KAY-010 · Kontenjan

- **Kural:** Kesin kayıt, hedef sınıfın aktif öğrenci sayısı + aynı sınıfa planlanmış (henüz uygulanmamış) yenilemeler kapasiteye ulaştıysa reddedilir. Sınıf kapasitesi `school` için en fazla 30'dur (okul öncesi 20); kapasite ayarı bu tavanı aşamaz.
- **Gerekçe:** Mevzuat azami sınıf mevcudu koyar; planlanmış yenilemeler de yer tutar.
- **Kaynak:** ÖÖKY md. 48/1 (RG 3/8/2022 değişikliği: okul öncesi 20, diğer okullar 30).
- **Kurum türü:** `school` (dil okulu grup kapasitesi için `DOM-DIL-040`)
- **Kodda:** çelişiyor — kontenjan denetimi var (`packages/school-core/src/lib/domain.js:113`) ama planlanmış yenilemeleri saymaz; sınıf kapasitesi 40'a kadar girilebiliyor (`packages/school-core/src/lib/school-management.js:23`).

### DOM-KAY-011 · Bir aday tek kesin kayıt

- **Kural:** Öğrenciye bağlanmış aday ikinci kez kayda dönüştürülemez. Aynı kişi (T.C. kimlik no veya yabancı kimlik no) aynı kurumda aynı eğitim yılı için ikinci aktif kayıt alamaz.
- **Gerekçe:** Mükerrer öğrenci = mükerrer borç.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `packages/school-core/src/lib/domain.js:111-112` (aday bazında); kimlik numarası alanı ve kişi bazlı tekillik yok.

### DOM-KAY-012 · Kimlik ve yasal temsilci zorunlu alanları

- **Kural:** `school` kesin kaydında öğrenci T.C. kimlik no (veya yabancı uyruklu kimlik no), doğum tarihi, en az bir veli (yakınlık derecesi, telefon) ve ödeyici zorunludur. `language_school`'da 18 yaş altı kursiyer için aynı veli kuralı uygulanır; 18 yaş ve üstünde kursiyerin kendisi sözleşme tarafı ve ödeyicidir.
- **Gerekçe:** e-Okul/e-Özel kaydı ve sözleşmenin geçerliliği için yasal temsilci gerekir; reşit olmayanın sözleşmesini yasal temsilcisi yapar.
- **Kaynak:** 4721 sayılı Türk Medeni Kanunu (ergin olmayanın temsili) — **doğrulanmalı**; ÖÖKY md. 53/1 (Bakanlıkça belirlenen tip sözleşme).
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — `packages/school-core/src/lib/domain.js:115-125,153-157` kimlik/doğum tarihi tutmaz ve her kayıtta "<ad> velisi" adlı yeni veli üretir.

### DOM-KAY-013 · Mevcut veliye bağlama (kardeş)

- **Kural:** Kesin kayıtta velinin telefonu/e-postası kurumda kayıtlı bir veliyle eşleşirse yeni veli açılmaz; öğrenci mevcut veliye bağlanır ve veli kardeş ilişkisini görür. Eşleşme ön büroya önerilir, otomatik birleştirilmez.
- **Gerekçe:** Kardeş indirimi, tek veli hesabı ve tek bildirim akışı aile bağına dayanır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — `packages/school-core/src/lib/domain.js:119,153-157` her kayıtta yeni `parentId` üretir.

### DOM-KAY-014 · Düzeye uygun sınıf

- **Kural:** `school` kaydında öğrencinin hedef düzeyi sınıfın düzeyiyle aynıdır; 9. sınıfa kayıt için ortaokul diploması/öğrenim belgesi bilgisi, ara sınıfa naklen kayıtta önceki okul ve nakil tarihi tutulur.
- **Gerekçe:** Nakil ve düzey MEB kayıt kurallarına tabidir; naklen gelenin dönem puanı önceki okulun puanlarıyla hesaplanır.
- **Kaynak:** OKY md. 52 (naklen gelenlerin dönem puanı).
- **Kurum türü:** `school`
- **Kodda:** yok — kayıt formu sınıfı serbest seçer, nakil bilgisi yok.

### DOM-KAY-015 · Kaydın e-Okul/e-Özel karşılığı

- **Kural:** Platformdaki kesin kayıt MEB sistemindeki kaydın yerini tutmaz. Kayıt "MEB'e işlendi" durumu ve işleyen kişi/tarih ile ayrıca işaretlenir; işaretlenmemiş kayıtlar yönetici listesinde görünür.
- **Gerekçe:** Öğrenci, ücret ve burs bilgisi MEBBİS/e-Okul/e-Özel modüllerine işlenmek zorundadır; platform bu yükümlülüğü takip eder, devralmaz.
- **Kaynak:** ÖÖKY md. 55/3, 59/4, 63/3.
- **Kurum türü:** ikisi (dil okulu MEB lisanslıysa e-Özel)
- **Kodda:** yok.

## Yenileme, dönem geçişi, ayrılış

### DOM-KAY-020 · Yenileme planı ile sınıf geçişi ayrı işlemdir

- **Kural:** Yeni yıl yenilemesi (sözleşme + taksit) planlandığında öğrencinin güncel sınıfı değişmez. Sınıf, ayrı "dönem geçişi" işlemiyle ve yalnız öğrenci sınıf geçme kararı aldıktan sonra değişir (`DOM-AKD-040`).
- **Gerekçe:** Kayıt yenileme bahar aylarında, sınıf geçme kararı Haziran'da kesinleşir.
- **Kaynak:** İşletme kuralı; OİKY md. 31/2-b, OKY md. 57-58.
- **Kurum türü:** `school`
- **Kodda:** var — `packages/school-core/src/lib/school-workflows.js:748-845` (plan) ve `846-927` (uygulama). Sınıf geçme kararı denetimi yok.

### DOM-KAY-021 · Yenileme tekilliği ve hedef düzey

- **Kural:** Bir öğrenci için aynı yıla tek yenileme açılır; planlanmış yenilemesi olan öğrenciye ikinci plan açılamaz. Hedef sınıf bir üst düzeydedir; sınıf tekrarı kararı varsa aynı düzeyde yenileme yapılabilir.
- **Gerekçe:** Mükerrer sözleşme ve taksit engellenir; sınıf tekrarı gerçek bir durumdur.
- **Kaynak:** İşletme kuralı; OİKY md. 31, OKY md. 58/1.
- **Kurum türü:** `school`
- **Kodda:** kısmen — tekillik `packages/school-core/src/lib/school-workflows.js:753-756`, hedef düzey `779-780`; sınıf tekrarı yolu yok (yalnız +1).

### DOM-KAY-022 · Mezuniyet

- **Kural:** Mezuniyet yalnız son düzeydeki (ortaokulda 8, lisede 12) öğrenci için ve mezuniyet koşulu sağlandığında uygulanır; yeni borç oluşturmaz. Mezun öğrencinin geçmiş not, devamsızlık ve tahsilat kayıtları salt okunur korunur; veli/öğrenci hesabı yalnız belgelerine erişir.
- **Gerekçe:** Ortaokul ve lise ayrı kurumlar olabilir; 8. sınıftan ayrılan öğrenci lise kaydına aday olur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `school`
- **Kodda:** kısmen — `packages/school-core/src/lib/school-workflows.js:757-776` yalnız 12. sınıfa izin verir; 8. sınıf çıkışı yok.

### DOM-KAY-023 · Dönem geçişinde bağlı kayıtlar

- **Kural:** Dönem geçişinde açık çalışma görevleri ve rehberlik dosyaları yeni sınıfın aynı branş öğretmenine devredilir; kampüs değişiyorsa servis ataması kaldırılır ve eski kampüs kulüp üyelikleri `Ayrıldı` olur; ileri tarihli etüt varsa geçiş engellenir. Geçmiş kayıtlar taşınmaz, silinmez.
- **Gerekçe:** Sorumluluk boşluğu bırakılmaz; geçmiş değiştirilmez.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `school`
- **Kodda:** var — `packages/school-core/src/lib/school-workflows.js:852-921`.

### DOM-KAY-024 · Kayıt dondurma ve ayrılış

- **Kural:** Öğrenci ayrılırken ayrılış tarihi, nedeni (nakil, taşınma, sağlık, ekonomik, memnuniyetsizlik, diğer) ve hedef okul tutulur; öğrenci pasifleşir, ileri tarihli etüt/servis/kulüp kayıtları sonlanır, iade hesabı `DOM-FIN-040` ile açılır. Dil okulunda kayıt dondurma (`DOM-DIL-052`) ayrılıştan ayrı bir durumdur.
- **Gerekçe:** Ücret iadesi ayrılış tarihine göre hesaplanır; neden verisi kayıp analizi için gerekir.
- **Kaynak:** ÖÖKY md. 56/3.
- **Kurum türü:** ikisi
- **Kodda:** yok — ayrılış/iade işlemi yok; yalnız mezuniyet `isActive=false` yapar (`packages/school-core/src/lib/school-workflows.js:885`).

### DOM-KAY-025 · Borçlu öğrencinin kaydı yenilenmeyebilir

- **Kural:** Ders yılı sonunda ödenmemiş öğrenim ücreti borcu olan öğrencinin yenilemesi yöneticinin açık onayı olmadan planlanamaz. Borç, akademik kayıtlara (karne, not, belge) erişimi engellemek için kullanılmaz.
- **Gerekçe:** Mevzuat yenilememe hakkı verir; belge/karne alıkoyma hakkı vermez.
- **Kaynak:** ÖÖKY md. 55/2 (yenilememe ve resmî okula nakil); karne/belge alıkoyma yasağı işletme yorumu — **doğrulanmalı**.
- **Kurum türü:** `school`
- **Kodda:** yok — yenileme borç denetimi yapmaz.

## Aday işlemleri (ön büro)

`DOM-KAY-002`, `-005`, `-006` ve `DOM-DIL-030`'un işlem düzeyindeki muhafazakâr yorumu. İşlemleri yalnız `yonetici` ve `onburo` yapar (yetki matrisi "Aday, tanışma görüşmesi"); modül `crm`.

### DOM-KAY-030 · Aşama geçiş tablosu

- **Kural:** Açık aşamalar (`Yeni aday`, `İletişime geçildi`, `Görüşme planlandı`, `Teklif verildi`) arasında yalnız ileri gidilir; aşama atlanabilir. Geri dönüş yoktur. `Görüşme planlandı` elle seçilmez, görüşme veya deneme dersi planlanınca girilir; `Kayıt oldu` yalnız kesin kayıtla girilir (`DOM-KAY-005`). `Vazgeçti` her açık aşamadan nedenle girilir; adayın ileri tarihli görüşmesi ve deneme dersi kalkar, gerçekleşmiş olanlar kalır. `Vazgeçti` aday yalnız `İletişime geçildi` aşamasına yeniden açılır, neden temizlenir ve açılış tekillik denetiminden (`DOM-KAY-002`) geçer.
- **Gerekçe:** Geri alınabilen aşama dönüşüm raporunu bozar; vazgeçen adayın tuttuğu görüşme saati ve deneme yeri başkasına açılmalıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`nextProspectStages`, `changeProspectStage`). Yanlış ileri geçişi düzelten işlem yoktur; gerekirse yönetici onaylı ayrı işlem olarak gelir (`TODO(crm-stage-back)`).

### DOM-KAY-031 · İletişimi paylaşan aday (kardeş)

- **Kural:** Aynı telefon veya e-postayı taşıyan açık aday varken: ad da aynıysa (boşluk ve büyük/küçük harf farkı gözetilmeden) yeni aday açılmaz; ad farklıysa yeni aday yalnız ön büro iletişimi paylaşan açık adayı kardeş olarak açıkça seçerse açılır. Kardeş seçimi aynı adın mükerrerliğini kaldırmaz. Ret iletisi telefon, e-posta veya diğer adayın adını içermez.
- **Gerekçe:** `DOM-KAY-002` kardeşe izin verir ama yazım farkıyla aynı kişinin ikinci kez açılmasını da engellemelidir; açık onay en muhafazakâr yoldur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`findProspectDuplicate`, `createProspect`).

### DOM-KAY-032 · Aday notu eklenir, değişmez

- **Kural:** Aday kartına not yalnız eklenir; düzenlenmez ve silinmez. Notu yazan kişi ve an saklanır. `Kayıt oldu` veya `Vazgeçti` adaya not eklenmez; vazgeçen adayla yeni temas önce adayı yeniden açar (`DOM-KAY-030`). Not alanında özel nitelikli veri yazılmaması için form uyarı gösterir.
- **Gerekçe:** Temas geçmişi satış ve şikâyet incelemesinin kanıtıdır; kapalı adaya temas eklemek imha süresini (`DOM-KAY-008`) sessizce uzatır.
- **Kaynak:** İşletme kuralı; KVKK md. 6 (özel nitelikli veri).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`addProspectNote`, `PROSPECT_NOTE_NOTICE`).

### DOM-KAY-033 · Tanışma görüşmesi planlama

- **Kural:** Görüşme adayın kampüsünde, gelecek bir anda, 15–120 dakika süreyle ve bir odada yapılır; isteğe bağlı görevli öğretmen aynı kampüsün aktif öğretmenidir. Aynı kampüsteki başka adayın görüşmesiyle aynı oda veya aynı öğretmen için aralık örtüşemez; oda bilgisi olmayan eski görüşme kampüsün bütün odalarını tutuyor sayılır. Öğretmenin dersi, randevusu, etüdü ve odanın ders/etüt/etkinlik kullanımı da çakışma sayılır. Yeniden planlama önceki görüşmenin yerini alır. Görüşme `Yeni aday`/`İletişime geçildi` adayı `Görüşme planlandı` yapar; `Teklif verildi` aday geri gitmez (`DOM-KAY-030`).
- **Gerekçe:** `DOM-KAY-006`'nın "görevli/oda" çakışması; bilinmeyen kaynak çakışıyor sayılır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleProspectMeeting`), çakışma `packages/school-core/src/lib/tutor-conflicts.ts`. Ön büro görevlisinin (kullanıcı) kendi çakışması yoktur (`TODO(crm-meeting-host)`).

### DOM-KAY-034 · Deneme dersi planlama

- **Kural:** Deneme dersi (`DOM-DIL-030`) yalnız `language_school`'da, adayın kampüsündeki açık grubun gelecek ve iptal edilmemiş gerçek dersine planlanır. "Program başına bir kez" aday kaydı başına bir kez olarak uygulanır: gerçekleşmiş deneme dersi tekrar planlanmaz, ileri tarihli olan değiştirilebilir. Derse en fazla iki deneme katılımcısı alınır; aktif kursiyer + deneme katılımcısı grup kapasitesini ve 18'i (`DOM-DIL-040`) aşamaz. 18 yaş altı (veya yaşı bilinmeyen) adayda veli adı, veli iletişim bilgisi ve ön büronun kaydettiği veli onayı zorunludur. Adayın görüşmesi ile deneme dersi örtüşemez. Deneme kaydı yoklamaya yazılmaz.
- **Gerekçe:** `DOM-DIL-030`'un kapasite ve veli onayı şartlarının en korumalı uygulanışı; seviye ve yaş bandı uygunluğu henüz veriyle denetlenemez.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 48/2.
- **Kurum türü:** `language_school`
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleTrialLesson`). Seviye ve yaş bandı uygunluğu (`DOM-DIL-041`) ön büro seçimine bırakılır (`TODO(crm-trial-level)`); öğretmenin deneme sonucu (`DOM-DIL-031`) yoktur (`TODO(crm-trial-result)`).

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-KAY-006 | Tanışma görüşmesi çakışması yalnız aynı başlangıç anını yakalar (`apps/web/src/views/Crm.vue:198-203`).                                                                                                                   |
| DOM-KAY-010 | Sınıf kapasitesi 40'a kadar girilebilir (`packages/school-core/src/lib/school-management.js:23`), ÖÖKY tavanı 30; kesin kayıt planlanmış yenilemeleri kontenjandan düşmez (`packages/school-core/src/lib/domain.js:113`). |
| DOM-KAY-012 | Kimlik no, doğum tarihi, yakınlık, ödeyici tutulmaz; veli adı "<öğrenci> velisi" olarak üretilir (`packages/school-core/src/lib/domain.js:153-157`).                                                                      |
| DOM-KAY-013 | Kardeş kaydı mevcut veliye bağlanmaz, her kayıt yeni veli açar (`packages/school-core/src/lib/domain.js:119`).                                                                                                            |
| DOM-KAY-021 | Sınıf tekrarı için aynı düzeyde yenileme yapılamaz (`packages/school-core/src/lib/school-workflows.js:779`).                                                                                                              |
| DOM-KAY-022 | 8. sınıf çıkışı/mezuniyeti tanımlı değil (`packages/school-core/src/lib/school-workflows.js:758`).                                                                                                                        |
