# Dil okulu

`language_school` kurumunun öğretim birimi olan seviye, kur ve grup; seviye tespiti, deneme dersi, devam, kur geçme, belge, paket satışı ve kursiyer türleri. Beceri görevleri, puanlama ve seviye önerisi hesabı [beceri-gelisimi.md](beceri-gelisimi.md), ücret ve iade [finans.md](finans.md), aday ve kesin kayıt [kayit-ve-crm.md](kayit-ve-crm.md) içindedir.

Mevzuat notu: MEB izinli bir yabancı dil kursu ÖÖKY md. 4/1-s tanımında "kişisel gelişim kursu" (çeşitli kurs) kapsamına girer; aynı kurum ortaöğretim derslerine destek veriyorsa "özel öğretim kursu" (md. 4/1-p) olabilir. Bazı hükümler (grup tavanı, seviye belirleme sınavı, haftalık saat) bu iki tür için farklıdır. Kurumun ruhsat türü kurum profilinde tutulur ve mevzuat profili (`DOM-AKD-001`) buna göre seçilir. Hangi dil okulunun hangi türde ruhsatlı olduğu **doğrulanmalı**.

## Seviye, kur ve program

### DOM-DIL-001 · Seviye ölçeği sabittir, kur kurumundur

- **Kural:** Seviye değerleri sabit listedir: `Pre-A1, A1, A2, A2+, B1, B1+, B2, B2+, C1, C2`. Kurum her seviyeyi bir veya daha çok kura böler (ör. `B1.1`, `B1.2`); kur tam olarak bir seviyeye bağlıdır ve sırası vardır. Seviye listesine kurum değer ekleyemez; kur adı ve sayısı kurum ayarıdır.
- **Gerekçe:** Seviye önerisi, kur geçme ve raporlar ortak ölçekle karşılaştırılabilir olmalı; kurların ayrıntısı kurumdan kuruma değişir.
- **Kaynak:** CEFR-CV (Pre-A1 ve artı seviyeler A2+, B1+, B2+). C1+ gibi resmî olmayan ara değerler kullanılmaz.
- **Kurum türü:** `language_school` (`school` İngilizce dersinde yalnız beceri profili için, bkz. `DOM-BEC-060`)
- **Kodda:** yok — kodda CEFR ve kur kavramı yok.

### DOM-DIL-002 · Kur süresi ders saatiyle tanımlanır

- **Kural:** Her kurun toplam ders saati, haftalık saati ve başlangıç/bitiş tarihi vardır. Bir ders saati 45 dakikadır; uygulamalı ders 90 dakikalık blok olabilir. Kurun toplam saati, kurumun MEB onaylı öğretim programında o seviye için öngörülen süreden az olamaz. GLH değerleri yalnız planlama önerisidir: kur saatleri GLH'ye eşitlenmez, çünkü GLH ders dışı yönlendirilmiş çalışmayı da içerir.
- **Gerekçe:** Ücret, devam oranı ve iade ders saatiyle hesaplanır; onaylı programın süresinin altına inen kur denetimde sorun çıkarır.
- **Kaynak:** ÖÖKY md. 10/6 (45 dakika, 90 dakika blok), md. 46/3 (onaylı program uygulanır); GLH (A1 ≈ 90–100 … C2 ≈ 1.000–1.200, birikimli, yalnız rehber). Onaylı yabancı dil programlarındaki seviye başı saatler **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-003 · Ders saatleri yasal çalışma aralığında

- **Kural:** Grup ve bireysel ders 07.00–23.00 arasında planlanır. Grupta zorunlu eğitim çağında bir kursiyer varsa dersler 21.00'de biter. Genel tatil günlerine ve valilik/Bakanlık tatil kararlarına denk gelen ders planlanamaz; karar sonradan gelirse ders iptal edilir ve `DOM-DIL-054` ile telafi edilir.
- **Gerekçe:** Mevzuat çalışma saatlerini ve tatile uymayı zorunlu kılar.
- **Kaynak:** ÖÖKY md. 10/6, 10/7.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-004 · Çalışma takvimi bildirime hazır tutulur

- **Kural:** Her kurun dönemlik takvimi ve haftalık ders çizelgesi (gün, saat, derslik, eğitmen) platformdan dışa aktarılabilir. Takvim değişikliği tarih ve değiştirenle kayıt altına alınır. Platform takvimi MEB'e göndermez; "MEM'e bildirildi" durumu ayrıca işaretlenir.
- **Gerekçe:** Kurslar takvimlerini bağlı oldukları millî eğitim müdürlüğüne gönderir; denetimde MEBBİS'e girilen gün/saatlerle derslerin tutarlılığı aranır.
- **Kaynak:** ÖÖKY md. 10/4, md. 67/5.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Seviye tespiti

### DOM-DIL-010 · Seviye tespit sınavı

- **Kural:** Aday veya kursiyer için seviye tespiti ücretsizdir ve iki bölümden oluşur: otomatik puanlanan okuma, dinleme ve dil kullanımı bölümü; öğretmenin rubrikle puanladığı yazma görevi ve konuşma görüşmesi. Platform beceri bazında sonuç ve seviye önerisi üretir (`DOM-BEC-030`); yerleştirme seviyesini öğretmen veya akademik koordinatör gerekçe yazarak seçer. Sonuç ve karar ayrı alanlardır. Tespit önerisi kendi eşiğiyle hesaplanır: oturumun her tamamlanmış bölüm sonucu bir kanıttır ve `DOM-BEC-032`'nin "en az 2 farklı gün" şartı aranmaz (başarı payı ve okuma/dinlemede en az 10 madde aynen geçerlidir). Otomatik puanlanan bölümlerden (dil kullanımı, okuma, dinleme) biri tamamlanmamışsa genel öneri çıkmaz; yazma veya konuşma henüz puanlanmamışsa yalnız o becerinin önerisi çıkmaz, diğerleri çıkar. Uzaktan tespit ön tespit olarak kalır (`DOM-DIL-011`). Öğrencinin görev kanıtları genel eşikle birlikte sayılır; tespiti yalnız destekler, aynı seviyede başarı payını 2/3'ün altına düşürürse tespit yolunu kapatır.
- **Gerekçe:** Yalnız çoktan seçmeli bölüm üretici becerileri ölçmez; makinenin önerisi karar yerine geçmez.
- **Kaynak:** İşletme kuralı. ÖÖKY md. 46/9 özel öğretim kurslarında seviye belirleme sınavlarının ücretsiz ve kurum binasında yapılmasını, dönem başı/ortası/sonunda tekrarlanmasını ister; bu hükmün kişisel gelişim kursu olan dil okuluna uygulanıp uygulanmadığı **doğrulanmalı**. Platform muhafazakâr olarak ücretsizliği her türde uygular.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `planPlacementSession`, `placementSectionResults`, `placementSummary` (tespit bağlamı, `PLACEMENT_AUTO_SECTIONS`), `planPlacementDecision` (gerekçe her zaman zorunlu, karar oturum başına bir; karar kopyası tespit önerisini taşır). Tespit eşiği `packages/school-core/src/cefr/suggestion.ts` `suggestCefrLevels({ context: { kind: 'placement' } })` ve `PLACEMENT_DEMONSTRATION_RULES`; genel bağlam değişmedi, `LevelTally.demonstratedBy` dayanağı gösterir (ADR 0004; tablolar, uçlar ve ekran F5b ve sonrası).
- **Not:** Tespit önerisi eşiği — kullanıcı onayı bekliyor (patron kararı, 30 Ekim 2026).

### DOM-DIL-011 · Uzaktan yapılan tespit ön tahmindir

- **Kural:** Kurum dışında (çevrim içi) çözülen seviye testi `ön tespit` olarak işaretlenir. Kesin yerleştirme için öğretmenle konuşma görüşmesi ve gözetimli yazma görevi gerekir. Ruhsat türü özel öğretim kursu olan kurumda seviye belirleme sınavı yalnız kurum binasında yapılır.
- **Gerekçe:** Gözetimsiz sonuç güvenilir değildir; özel öğretim kursları için yer şartı vardır.
- **Kaynak:** ÖÖKY md. 46/9; dil okuluna uygulanışı **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `PLACEMENT_MODES` (`remote` ön tespit), `planPlacementDecision` uzaktan oturumu reddeder, `placementRequired`; ön tespit `packages/school-core/src/cefr/suggestion.ts` seçiminde kanıt değildir. Ruhsat türüne göre yer şartı yok (`TODO(cefr-ruhsat-turu)`) (ADR 0004; tablolar, uçlar ve ekran F5b ve sonrası).

### DOM-DIL-012 · Tespit sonucunun geçerlilik süresi

- **Kural:** Seviye tespit sonucu 90 gün geçerlidir. Bu süre içinde kayıt olmayan aday veya kaydı 90 günden uzun dondurulan kursiyer (`DOM-DIL-052`) yeniden tespite girer. Aynı aday bir dönem içinde en fazla iki kez tespit sınavına girer; ikinci sınav farklı soru formuyla yapılır.
- **Gerekçe:** Dil seviyesi zamanla değişir; aynı formu tekrar çözmek sonucu şişirir.
- **Kaynak:** İşletme kuralı (90 gün ve iki sınav sınırı).
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `placementValidity` (bitiş anı + 90 × 24 saat, son an hariç; `TODO(cefr-gecerlilik-siniri)`), `planPlacementSession` (dönemde iki oturum, ikincisi farklı formla; `TODO(cefr-donem)`, `TODO(cefr-farkli-form)`); dondurma sonrası yeniden tespit yok (`TODO(cefr-dondurma)`) (ADR 0004; tablolar, uçlar ve ekran F5b ve sonrası).

### DOM-DIL-013 · Kur içi ilerleme değerlendirmesi

- **Kural:** Her kurda en az üç ölçme noktası vardır: başlangıç (tanılayıcı), ara ve kur sonu. Her ölçmenin sonunda kursiyere beceri ve konu bazında yazılı geri bildirim verilir. Başlangıç ölçmesi not yerine geçmez; kur geçme kararına yalnız ara ve kur sonu ölçmeleri girer.
- **Gerekçe:** Mevzuat kurslarda dönem başı, ortası ve sonunda gelişim takibi ve konu bazında geri bildirim ister; tanı amaçlı ölçme cezalandırmamalı.
- **Kaynak:** ÖÖKY md. 46/9 (özel öğretim kursları); dil okulunda örnek alınarak uygulanır.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Deneme dersi

### DOM-DIL-030 · Deneme dersi

- **Kural:** Aday, seviyesine uygun açık bir grubun gerçek dersine program başına bir kez, ücretsiz katılabilir. Deneme katılımcısı yoklamada kursiyer olarak sayılmaz; ayrı `deneme` kaydı tutulur. Ders anındaki kursiyer sayısı + deneme katılımcısı sayısı grup kapasitesini (`DOM-DIL-040`) aşamaz ve bir derse en fazla iki deneme katılımcısı alınır. 18 yaş altı adayın deneme dersi için veli onayı ve veli iletişim bilgisi zorunludur. Deneme dersinin çakışma denetimi `DOM-KAY-006` ile aynıdır (süre dikkate alınır).
- **Gerekçe:** Deneme dersi satışın ana aracıdır ama derslikteki yasal mevcudu ve kayıtlı kursiyerin ders kalitesini bozmamalıdır. İlan edilmeyen ücret alınamayacağı için ücretli deneme dersi ancak ücret ilanında yer alırsa mümkündür; platform bunu desteklemez.
- **Kaynak:** İşletme kuralı (bir kez, en fazla iki katılımcı); ÖÖKY md. 48/2 (mevcut), md. 54/1-b ve c (ilan dışı ücret yasağı).
- **Kurum türü:** `language_school`
- **Kodda:** yok — yalnız tanışma görüşmesi var (`apps/web/src/views/Crm.vue:198-203`).

### DOM-DIL-031 · Deneme dersi sonucu adayı kaydetmez

- **Kural:** Deneme dersinden sonra öğretmen adayın kartına seviye uygunluğu (`uygun`, `alt kur önerilir`, `üst kur önerilir`) ve kısa not yazar. Bu not aday aşamasını `Teklif verildi` dışına taşımaz; kesin kayıt yalnız kayıt işlemiyle olur (`DOM-KAY-005`).
- **Gerekçe:** Satış hunisi ile akademik karar karışmamalı.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Grup ve kayıt

### DOM-DIL-040 · Grup kapasitesi en fazla 18

- **Kural:** Bir grubun kapasitesi 1–18 arasındadır; aktif (dondurulmamış) kursiyer + bekleme listesinden yapılmış ve süresi dolmamış teklif (`DOM-DIL-043`) + o derse gelen deneme katılımcısı kapasiteyi aşamaz. Kapasite derslik kapasitesinden de büyük olamaz. Bireysel ders grubu kapasitesi 1'dir.
- **Gerekçe:** Mevzuat kurslarda mevcut tavanı koyar; dil öğretiminde konuşma pratiği küçük grup gerektirir.
- **Kaynak:** ÖÖKY md. 48/2: okul dışındaki kurumlarda tavan 30, özel öğretim kursları ile sosyal etkinlik ve gelişim merkezlerinde 18. Kişisel gelişim kursu ruhsatlı dil okulu için yasal tavan 30 görünür; platform her iki türde muhafazakâr olarak 18'i tavan alır. Tavanı 30'a çıkarmak, ruhsat türü **doğrulandıktan** sonra mevzuat profili değişikliğiyle yapılır, kurum ayarıyla yapılmaz.
- **Kurum türü:** `language_school` (`school` sınıf mevcudu için `DOM-KAY-010`)
- **Kodda:** yok — dil grubu yok; sınıf kapasitesi 40'a kadar girilebiliyor (`packages/school-core/src/lib/school-management.js:23`).

### DOM-DIL-041 · Grup seviye ve yaşa göre oluşur

- **Kural:** Kursiyer yalnız yerleştirme seviyesindeki kura bağlı gruba kaydolur; bir alt veya üst kura kayıt öğretmen gerekçesiyle yapılır. Gruplar yaş bandıyla tanımlanır (`çocuk`, `genç` 12–17, `yetişkin` 18+; çocuk bandının alt sınırı programa göre); 18 yaş altı kursiyer yetişkin grubuna, yetişkin genç grubuna yalnız yönetici onayı ve gerekçeyle girer.
- **Gerekçe:** Mevzuat grupların yaş ve bilgi düzeyine göre oluşturulmasını ister; reşit olmayanla yetişkinin aynı grupta olması ayrı bir koruma değerlendirmesi gerektirir.
- **Kaynak:** ÖÖKY md. 48/2; yaş bantları işletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-042 · Grup açılış sayısı ve birleştirme

- **Kural:** Her grubun asgari açılış sayısı (kurum ayarı) vardır. Başlangıç tarihinde asgari sayıya ulaşmayan grup açılmaz; kayıtlı kursiyerlere seçenek sunulur: aynı kurdaki başka gruba geçiş, bekleme veya ücretin tamamının iadesi. Kursiyerin onayı olmadan başka gün/saatteki gruba taşınmaz.
- **Gerekçe:** Kurum kaynaklı iptalde kursiyer kesintiye uğramamalı; tarih/saat sözleşmenin esasıdır.
- **Kaynak:** İşletme kuralı; tam iade, ÖÖKY md. 56/3-b'deki %10 kesintinin kursiyer kaynaklı ayrılış için olduğu yorumuna dayanır — **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-043 · Bekleme listesi

- **Kural:** Dolu gruba kayıt isteyen aday bekleme listesine sırayla girer. Yer açılınca sıradaki adaya 48 saat geçerli teklif gider; süre dolarsa sıradakine geçilir. Bekleme listesi kapasiteye sayılmaz ve ödeme alınmaz.
- **Gerekçe:** Adil sıra ve ilan dışı ön ödeme yasağı.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 54/1-c.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-044 · Kurumlar arası nakil yoktur

- **Kural:** Kursiyerin başka bir kurumdaki kurdan "nakil" ile devam etmesi kaydedilmez; dışarıdan gelen kursiyer seviye tespitiyle kayıt olur. İstisna olarak kurumun kapanması veya kursiyerin il/ilçe değiştirmesi hâlinde aynı programın kalan bölümüne kayıt yapılır ve önceki kurum ile tamamlanan saat kaydedilir. Bir seviyeyi tamamlayan kursiyer üst seviyeye başka kurumda devam edebilir; bu yeni kayıttır.
- **Gerekçe:** Mevzuat kurslar arası nakli yasaklar, istisnalarını sayar.
- **Kaynak:** ÖÖKY md. 51/7.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-045 · Kursiyer kaydının zorunlu alanları

- **Kural:** Kesin kayıtta kursiyerin T.C. kimlik no (yabancı için yabancı kimlik no veya pasaport), ad soyad ve doğum tarihi zorunludur. Kayıt MEBBİS'e işlenene kadar `MEBBİS'e işlenmedi` durumunda görünür (`DOM-KAY-015`). Bir kursiyer aynı program içinde aynı anda yalnız bir gruba kayıtlıdır; farklı programlarda (ör. genel İngilizce + IELTS) saatleri çakışmamak şartıyla iki kaydı olabilir.
- **Gerekçe:** Kurs kayıtları MEBBİS üzerinden yapılır ve bu bilgiler kayıtta istenir.
- **Kaynak:** ÖÖKY md. 51/7, 51/11.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Paket, saat satışı ve esnek dönem

### DOM-DIL-050 · Ücret ders saati üzerinden

- **Kural:** Dil okulunda öğrenim ücreti ders saati ücreti olarak ilan edilir. Kur veya paket fiyatı = ders saati sayısı × ilan edilen saat ücreti − ilanda yer alan indirimler. İndirim toplamı ilan edilen ücretin %50'sini aşamaz (kurucunun kurumlarında çalışan personelin çocukları hariç); ilan üstü fiyat girilemez, ilan altı fiyat girilebilir. Kitap, materyal ve sınav hazırlık setleri ayrı ilan edilen ücret kalemidir.
- **Gerekçe:** Mevzuat kurslarda ücreti ders saati üzerinden hesaplatır ve indirimi sınırlar.
- **Kaynak:** ÖÖKY md. 54/1-a ve d, md. 55/1-c, md. 53/5. Ayrıntı `DOM-FIN`.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — kayıt tutarı serbest toplam TL, saat bilgisi yok (`packages/school-core/src/lib/domain.js:19-29`).

### DOM-DIL-051 · Saat bakiyesi hesaplanır ve yanmaz

- **Kural:** Paket saat bakiyesi saklanmaz; satın alınan saat − tüketilen saat − iade edilen saat olarak hesaplanır. Grup kurunda tüketim, kursiyerin kayıtlı olduğu sürede yapılmış derslerin saatidir (kursiyerin devamsızlığı saati geri vermez). Bireysel/esnek pakette tüketim, gerçekleşen ve geç iptal edilen (`DOM-DIL-054`) derslerdir. Paketin kullanım süresi olabilir; süre dolduğunda kullanılmayan saatler silinmez, kursiyerin seçimine göre süre uzatılır veya `DOM-FIN-040` ile iade hesabına girer.
- **Gerekçe:** Hesaplanabilen değer saklanmaz; mevzuat ayrılanlara alınmamış ders saatlerinin iadesini öngörür, "kullanılmayan saat yanar" koşulu bununla çelişir.
- **Kaynak:** ÖÖKY md. 56/3-b ve 4 (iade bir ay içinde); süre dolumunda yanma yasağının 6502 açısından değerlendirilmesi **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-052 · Kayıt dondurma

- **Kural:** Kursiyer (18 yaş altında veli) gerekçeyle kayıt dondurma ister; yönetici onaylar. Dondurma kur sınırında başlar (kur bitiminde veya yeni kur başlamadan). Kur ortasında dondurma yalnız sağlık, askerlik, taşınma, iş/okul takvimi gibi belgeli nedenle olur; bu durumda kursiyer o kuru `tamamlamadı` olarak kapatır ve kalan ders saatleri bakiyeye geçer. Dondurma süresinde saat tüketilmez, devamsızlık yazılmaz, kursiyer grup kapasitesinde yer tutmaz (dönüşte aynı grup garanti edilmez). Bir kayıtta toplam dondurma 6 ayı geçemez; süre dolunca kursiyer döner veya ayrılış (`DOM-KAY-024`) ve iade (`DOM-FIN-040`) işlemi açılır. Dönüşte 90 günü aşan dondurmada seviye tespiti yenilenir (`DOM-DIL-012`). Dondurma ayrılış değildir; taksit planı dondurma süresince ertelenir ve yeni plan kursiyere/veliye onaylatılır.
- **Gerekçe:** Yetişkin kursiyerlerde ara verme yaygındır; kur ortasında dondurup başka gruba dönmek devam ve kur geçme hesabını bozar.
- **Kaynak:** İşletme kuralı (ÖÖKY'de dondurma hükmü bulunamadı). MEBBİS'teki kursiyer kaydına etkisi (kayıt kapatma/yeniden açma) **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-053 · Esnek dönem

- **Kural:** Dil okulunun dönemi eğitim-öğretim yılına bağlı değildir; her kurun kendi başlangıç, bitiş, toplam saat ve haftalık planı vardır ve kurlar yıl içinde her hafta başlayabilir. Raporlar takvim aralığına göre alınır. Ruhsat türü özel öğretim kursu olan kurumda program başına haftalık ders 3–8 saat ve yıllık takvim 18–36 hafta aralığında kalır.
- **Gerekçe:** Dil okulu sürekli kayıt alır; özel öğretim kursları için mevzuat haftalık ve yıllık sınır koyar.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 10/9 (özel öğretim kursları).
- **Kurum türü:** `language_school`
- **Kodda:** yok — `academicYear` tamsayı yıl modelidir.

### DOM-DIL-054 · Ders iptali ve telafi

- **Kural:** Kurum kaynaklı iptal edilen grup dersi kurun toplam saatinden düşmez; kur bitişinden önce telafi dersi planlanır ve kursiyerlere bildirilir. Bireysel derste kursiyer 24 saat öncesine kadar ücretsiz iptal eder; daha geç iptal veya gelmeme tüketilmiş saat sayılır. Eğitmen kaynaklı iptal hiçbir zaman saat tüketmez.
- **Gerekçe:** Kursiyer satın aldığı saati almalıdır; son dakika iptali eğitmen saatini boşa harcatır.
- **Kaynak:** İşletme kuralı (24 saat).
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Devam

### DOM-DIL-060 · Devam şartı: kur süresinin en az 4/5'i

- **Kural:** Kur sonu sınavına girebilmek için kursiyerin kurun toplam ders saatinin en az 4/5'ine katılmış olması gerekir; 1/5'ten fazla devamsızlık yapan kursiyer sınava alınmaz ve kuru `devamsızlıktan tamamlamadı` olarak bitirir. Devam oranı ders saati bazında hesaplanır, saklanmaz. Mevzuat özürlü/özürsüz ayrımı yapmadığından özürlü devamsızlık da sayılır. Kurum daha sıkı oran tanımlayabilir, daha gevşek tanımlayamaz.
- **Gerekçe:** Kurslara devam zorunludur.
- **Kaynak:** ÖÖKY md. 10/8.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-061 · Yoklama ders saati bazlıdır

- **Kural:** Yoklama her ders saati için alınır (`katıldı`, `geç`, `gelmedi`). Geç kalan kursiyer o ders saatine katılmış sayılır; ders saatinin yarısından fazlasını kaçıran kursiyer o saat için `gelmedi` yazılır. Gelecek ders için yoklama alınmaz; aynı ders saati için ikinci yoklama kaydı açılmaz, düzeltme kayıt geçmişine yazılır. Dondurulmuş kursiyer yoklama listesinde yer almaz.
- **Gerekçe:** Devam şartı ve saat tüketimi ders saatiyle ölçülür; denetimde MEBBİS'teki ders saatleriyle karşılaştırılır.
- **Kaynak:** ÖÖKY md. 10/8, md. 67/5; yarım saat eşiği işletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — yoklama sınıf ve gün bazlıdır, durumlar `present/absent/late/excused` (`packages/school-core/src/lib/domain.js:50-74`).

### DOM-DIL-062 · Devamsızlık bildirimi

- **Kural:** Kursiyerin devamsızlığı kur saatinin %10'una ulaşınca, ve %15'e ulaşınca ikinci kez kursiyere (18 yaş altında veliye de) bildirim gider; ikinci bildirim "%20'yi aşarsa kur sonu sınavına giremez" uyarısını içerir.
- **Gerekçe:** Kursiyer sınır aşılmadan uyarılmalı.
- **Kaynak:** İşletme kuralı (eşikler).
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Kur geçme ve kur atlama

### DOM-DIL-070 · Kur geçme kararı

- **Kural:** Kur sonunda karar `geçti`, `tekrar` veya `devamsızlıktan tamamlamadı` olur. `geçti` için üç koşul birlikte gerekir: devam şartı (`DOM-DIL-060`), kur sonu değerlendirmesinde 100 üzerinden kurum eşiğine (varsayılan 60) ulaşmak, dört becerinin her birinde ayrı ayrı 100 üzerinden 50'ye ulaşmak. Karar öğretmen tarafından verilir ve akademik koordinatör onaylar; seviye önerisi (`DOM-BEC-030`) karara gerekçe olarak eklenir ama kararı kendisi vermez. Onaylanmış karar değişmez; düzeltme gerekçeli yeni karar kaydıyla yapılır.
- **Gerekçe:** Tek bir toplam puan zayıf bir beceriyi gizler; makine önerisi denetlenebilir öğretmen kararının yerini almaz.
- **Kaynak:** İşletme kuralı (eşikler). ÖÖKY md. 46/4 ve 46/A başarının tespitini Bakanlık esaslarına bağlar; MEB'in kurs başarı ölçütü **doğrulanmalı** ve kurum eşiği bu ölçütün altına inemez.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-071 · Kur atlama ve kur tekrarı

- **Kural:** Kursiyer kur ortasında bir üst kura yalnız ara değerlendirmede beceri profilinin üst kura işaret etmesi, öğretmen önerisi ve koordinatör onayıyla geçer; kalan saat yeni kura aktarılır, fiyat farkı varsa ilan fiyatıyla hesaplanır. Tekrar kararı alan kursiyer aynı seviyedeki kuru yeniden alır; tekrar kuru yeni satıştır ve indirim uygulanacaksa ilanda yer alır.
- **Gerekçe:** Hızlı ilerleyen kursiyer tutulmamalı, ama atlama kanıta dayanmalı.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 54/1-a.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-072 · Yanlış yerleştirme düzeltmesi

- **Kural:** Kurun ilk iki haftasında öğretmen yerleştirmenin yanlış olduğunu bildirirse kursiyer bir alt veya üst kura ücret farkı dışında masrafsız geçirilir; tüketilen saat yeni kurdan düşer. İki haftadan sonra geçiş `DOM-DIL-071` ile yapılır.
- **Gerekçe:** Seviye tespitinin hatası kursiyere yüklenmemeli.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Belgeler

### DOM-DIL-080 · MEBBİS Kurs Bitirme Belgesi

- **Kural:** Kursu bitiren ve sınavda başarılı olan kursiyere Kurs Bitirme Belgesi MEBBİS'te düzenlenir. Platform bu belgeyi üretmez veya taklit etmez; yalnız belgeye hak kazanan kursiyer listesini çıkarır ve belgenin MEBBİS'te düzenlendiğini (belge no, tarih, işleyen) işaretler. Devam şartını sağlamayan veya sınavda başarısız olan kursiyer listeye girmez.
- **Gerekçe:** Resmî belge yalnız MEB sisteminde düzenlenir.
- **Kaynak:** ÖÖKY md. 46/4 (EK-6), md. 10/8.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-081 · Kurum başarı belgesi

- **Kural:** Platformun ürettiği belge "kurum başarı belgesi"dir ve öyle adlandırılır. Belgede kur adı, toplam ders saati, devam oranı, kurum değerlendirmesine göre seviye ve beceri profili yer alır; seviye ifadesi "kurum değerlendirmesine göre CEFR B1 düzeyinde" biçimindedir. "CEFR sertifikası", "Avrupa Konseyi onaylı" gibi ifadeler ve MEB amblemi kullanılmaz. Belgenin doğrulama kodu vardır.
- **Gerekçe:** CEFR bir sınav veya sertifika değildir; Avrupa Konseyi kurumları onaylamaz. Resmî belge görünümü yanıltıcıdır.
- **Kaynak:** CEFR-CV; Cambridge English, "Using the CEFR: Principles of Good Practice" (CEFR bir onay mührü değildir). Belge PDF şablonu kuralları proje `CLAUDE.md`'dedir.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-082 · Belge numarası ve iptal

- **Kural:** Kurum başarı belgesinin numarası kurum içinde tekildir ve yeniden kullanılmaz. Düzenlenmiş belge değiştirilmez; hata varsa belge `iptal` edilir ve yeni numarayla yeniden düzenlenir. Doğrulama sorgusu iptal edilmiş belge için "iptal edildi" döner ve kişisel veri olarak yalnız ad-soyad baş harflerini, kur ve tarihi gösterir.
- **Gerekçe:** Belge sahteciliğine ve sessiz değişikliğe karşı iz bırakılır; doğrulama sayfası kişisel veri sızdırmamalı.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (ölçülülük).
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Kursiyer türleri

### DOM-DIL-090 · Yetişkin kursiyerin velisi yoktur

- **Kural:** Kayıt tarihinde 18 yaşını doldurmuş kursiyer kendi hesabıyla kaydolur; veli kaydı açılmaz. Sözleşme tarafı kursiyerdir; ödeyici kursiyer veya kurumsal kayıtta işverendir. Kursiyerin verisi (devam, not, ses kaydı) üçüncü kişilere (eş, ebeveyn, işveren) gösterilmez; kursiyer isterse sınırlı yetkili kişi tanımlar (`DOM-DIL-093`). Yaş, doğum tarihinden Europe/Istanbul gününe göre hesaplanır.
- **Gerekçe:** Ergin kişi kendi adına sözleşme yapar; verisine erişim onun kararıdır.
- **Kaynak:** 4721 sayılı TMK md. 11–12 (erginlik) — **doğrulanmalı**; KVKK md. 5.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — kesin kayıt her öğrenci için yeni veli üretir (`packages/school-core/src/lib/domain.js:119,153-157`).

### DOM-DIL-091 · Reşit olmayan kursiyer

- **Kural:** 18 yaş altı kursiyer en az bir veliye bağlanır; sözleşmeyi veli yapar, onayları veli verir (`DOM-KAY-012`). Veli yalnız kendi çocuğunun devam, ilerleme ve ödeme bilgisini görür. Zorunlu eğitim çağındaki kursiyerin ders saatleri `DOM-DIL-003` sınırına uyar; ruhsat türü özel öğretim kursu olan kurumda kursiyerin MEBBİS kaydı e-Okul ile ilişkilendirilir ve kursiyer yalnız sınıf düzeyine uygun programa kaydolur.
- **Gerekçe:** Reşit olmayanı yasal temsilcisi temsil eder; özel öğretim kursları için e-Okul bağı zorunludur.
- **Kaynak:** ÖÖKY md. 51/12 (özel öğretim kursları), md. 10/6; TMK — **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-092 · 18 yaşa giriş

- **Kural:** Kayıtlı kursiyer 18 yaşına girdiği gün veli erişimi askıya alınır ve kursiyere bildirilir; kursiyer onaylarsa veli `yetkili kişi` olarak kalır. Veli imzalı mevcut sözleşme ve ödeyici süre sonuna kadar değişmez; yeni sözleşmeyi kursiyer yapar.
- **Gerekçe:** Erginlikle birlikte veri üzerindeki karar kişinin kendisine geçer; devam eden borç ilişkisi kendiliğinden el değiştirmez.
- **Kaynak:** İşletme kuralı; KVKK md. 5; borç ilişkisinin devamı **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-093 · Kurumsal kursiyer ve yetkili kişi

- **Kural:** İşverenin ödediği kurumsal eğitimde işverene yalnız devam oranı ve kur sonucu raporlanır; bunun için kursiyere kayıtta aydınlatma yapılır. Yazma ürünleri, ses kayıtları ve öğretmen yorumları işverene verilmez. Yetişkin kursiyerin tanımladığı yetkili kişi de yalnız kursiyerin seçtiği alanları görür ve kursiyer yetkiyi her an geri alabilir.
- **Gerekçe:** Ödeyici olmak verinin tamamına erişim hakkı vermez; ölçülülük.
- **Kaynak:** KVKK md. 4, 10; işveren raporunun hukuki dayanağı (sözleşmenin ifası mı açık rıza mı) **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-094 · Başarı durumu sıralanıp yayımlanmaz

- **Kural:** Kursiyerlerin puanları, seviyeleri ve devam durumları adla sıralanmaz, grup içinde veya herkese açık lider tablosunda gösterilmez. Grup raporları öğretmene ve yöneticiye açıktır; kursiyer yalnız kendi sonucunu ve grup ortalamasını görür.
- **Gerekçe:** Mevzuat kursiyerlerin kişisel bilgileri ile başarı durumlarının e-Özel ve denetim yetkilileri dışında paylaşılmasını yasaklar.
- **Kaynak:** ÖÖKY md. 46/9 (özel öğretim kursları); kişisel gelişim kursunda da KVKK md. 4 gereği uygulanır.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-DIL-001 | CEFR seviyesi, kur ve `language_school` kurum türü kodda yok; ders/sınıf düzeyi modeli tek modeldir.                                            |
| DOM-DIL-040 | Dil grubu kavramı yok; sınıf kapasitesi 40'a kadar girilebiliyor (`packages/school-core/src/lib/school-management.js:23`), dil grubu tavanı 18. |
| DOM-DIL-050 | Kayıt tutarı serbest TL toplamıdır, ders saati ve saat ücreti yok (`packages/school-core/src/lib/domain.js:19-29`).                             |
| DOM-DIL-053 | Dönem `academicYear` tamsayı yıldır; kur bazlı esnek dönem yok.                                                                                 |
| DOM-DIL-061 | Yoklama gün bazlıdır ve `excused` durumu vardır; ders saati bazlı yoklama yok (`packages/school-core/src/lib/domain.js:50-74`).                 |
| DOM-DIL-090 | Her kesin kayıt yeni veli üretir; velisiz yetişkin kursiyer kaydı yapılamaz (`packages/school-core/src/lib/domain.js:119,153-157`).             |
