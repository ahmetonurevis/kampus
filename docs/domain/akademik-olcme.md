# Akademik ölçme

MEB not sistemi, dönem ve yılsonu puanı, karne, devamsızlık, sınıf geçme, ödül belgeleri, deneme sınavı ve optik okuma. Ortaokul (5–8) [OİKY], lise (9–12) [OKY] hükümlerine tabidir. Dil okulunun kur başarısı, devam şartı ve sertifikası [dil-okulu.md](dil-okulu.md), dört beceri görevlerinin puanlaması [beceri-gelisimi.md](beceri-gelisimi.md) içindedir.

Platform e-Okul'un yerini tutmaz. Resmî not, devamsızlık, karne ve sınıf geçme kararı e-Okul'dadır. Platform aynı kuralla ön hesap yapar, veliyi bilgilendirir ve e-Okul'a işlenecek veriyi hazırlar.

## Mevzuat profili

### DOM-AKD-001 · Sürümlü mevzuat profili

- **Kural:**
  - **Profil kapsamı:** Eşik, gün sayısı, oran, ölçme sayısı, yuvarlama ve bildirim günü gibi mevzuattan gelen her sayı kodda sabit değildir; **mevzuat profili** kaydında parametre olarak tutulur.
  - **Profil anahtarı:** kurum türü (`school`, `language_school`), kademe (`ortaokul`, `lise`, `kurs`), eğitim yılı ve geçerlilik başlangıç tarihi.
  - **Kaynak bilgisi:** Her parametre kaynağını taşır: mevzuat etiketi, madde/fıkra, Resmî Gazete tarih ve sayısı.
  - **Hangi profil:** Hesap, kaydın ait olduğu eğitim yılının ve tarihin profiliyle yapılır. Yıl içinde değişiklik yürürlüğe girerse yeni sürüm geçerlilik tarihinden itibaren uygulanır.
  - **Değişmezlik:** Yayımlanmış profil değiştirilmez; düzeltme yeni sürümle yapılır.
  - **Geçmiş kayıtlar:** Karne, sınıf geçme kararı, iade ve sözleşme gibi hesaplanmış kayıtlar kullandıkları profil sürümünü saklar. Yeni sürüm geçmişi yeniden hesaplamaz.
  - **Kurum sınırı:** Kurum, profilin yasal değerlerini gevşetemez. Yalnız mevzuatın kuruma bıraktığı seçimleri yapar: zümre kararıyla ek performans puanı, ek sınav, uyarı eşikleri, bildirim kanalı.
  - **Finans:** Finans parametreleri de (`DOM-FIN`) aynı profilde tutulur.
  - **Sorumluluk:** Profil yayımlama yetkisi platform işletmecisindedir, kurum yöneticisinde değildir.
- **Gerekçe:** MEB yönetmelikleri neredeyse her yıl değişir; 2023, 2025 ve 2026 değişiklikleri not, devamsızlık ve rapor kurallarını değiştirdi. Sabit sayı ya eski öğrencinin notunu bozar ya da yeni kuralı geciktirir. Özel okul kendi yönetmeliğine başarı notu ve devam-devamsızlık hükmü koyamaz.
- **Kaynak:** ÖÖKY md. 46/1 (kurum yönetmeliklerinde başarı notu, devam-devamsızlık bulunamaz; RG 16/2/2024-32462); değişiklik örnekleri OİKY (RG 14/10/2023, 17/1/2025, 28/7/2026), OKY (RG 8/9/2023, 22/2/2025).
- **Kurum türü:** ikisi
- **Kodda:** yok — profil kavramı yok. Eşikler ve sayılar dağınık sabittir (ör. taksit sayısı `packages/school-core/src/lib/domain.js:27`, gecikme `packages/school-core/src/lib/format.js:48-50`); not ve devamsızlık kuralı hiç yoktur.

### DOM-AKD-002 · Kademe ayrımı

- **Kural:** Öğrencinin kademesi sınıf düzeyinden türetilir: 5–8 `ortaokul` (OİKY), 9–12 `lise` (OKY). Not, devamsızlık, sınıf geçme ve ödül kuralları kademeye göre seçilir. Ortak bir "ortalama" fonksiyonu iki kademede aynı sonucu vermez; her hesap kademenin kuralını çağırır. `language_school` kursiyeri bu kurallara tabi değildir (`DOM-DIL`). Okul öğrencisi aynı kurumda İngilizce beceri modülünü kullanabilir; o modülün puanı resmî nota ancak `DOM-AKD-060` ile girer.
- **Gerekçe:** Ortaokul ve lisede dönem puanı formülü, başarı eşiği, devamsızlık birimi ve sınıf geçme mantığı farklıdır.
- **Kaynak:** OİKY md. 21, 27, 28, 31; OKY md. 36, 44, 51, 56-58.
- **Kurum türü:** `school`
- **Kodda:** yok — düzey yalnız sınıf ve deneme eşleşmesinde kullanılır (`packages/school-core/src/lib/school-workflows.js:501`).

### DOM-AKD-003 · Puan ölçeği, ondalık ve yuvarlama

- **Kural:** Sınav, performans, proje ve katılım puanları 0–100 arasıdır. Ara ortalamalarda bölme virgülden sonra dört basamak yürütülür. Ortaokulda dönem puanı ve yılsonu puanı yarım ve üstü yukarı yuvarlanarak tam sayıya çevrilir. Lisede dönem puanı, yılsonu puanı ve yılsonu başarı puanı dört ondalıkla kalır. Değerler kayan noktada değil, ölçekli tamsayı (×10⁴) olarak saklanır.
- **Gerekçe:** 49,99 ile 50,00 arasındaki fark başarı ile başarısızlık arasındaki farktır; kayan nokta hatası veya erken yuvarlama sonucu değiştirir.
- **Kaynak:** OİKY md. 27/2-b, 27/3-a, 28/1; OKY md. 51/1-e, 53/2, 55/1. "Dört basamak yürütülür" ifadesinin dördüncü basamakta kesme mi yuvarlama mı olduğu **doğrulanmamış**; profilde `decimalMode` parametresi, varsayılan kesme.
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — `packages/school-core/src/lib/format.js:46-47` (`average`) her ortalamayı `Math.round` ile tam sayıya yuvarlar.
  - **Yönetim ekranı sınıf ortalaması (IST-010, `GET /api/v1/class-metrics`):** öğrencinin notlarının ortalaması yuvarlanmaz, sınıf ortalaması yalnız sonda bir kez yuvarlanır (erken yuvarlama sonucu değiştirir). Not kaydında öğretim yılı alanı olmadığı için öğrencinin **güncel sınıfı** esastır: sınıf değiştiren öğrencinin eski sınıftaki notları yeni sınıfın ortalamasına girer. Bu bir kısıttır; kayıt öğretim yılı taşıyınca (`DOM-AKD-001` profil anahtarı) sınıf ve yıl eşlemesiyle değişir.
  - **Notsuz öğrenci:** hiç notu olmayan öğrenci sınıf ortalamasına girmez, "notu olan öğrenci" sayısı ayrı döner. Bu, 0 sayan eski Vue davranışından bilinçli bir sapmadır; `DOM-AKD-013`'ün `K`/`G` durumu ise "puan yok ama 0 gibi sayılır" kuralıdır, ikisi karıştırılmaz: yalnız hiç not kaydı olmayan öğrenci dışarıda kalır.

### DOM-AKD-004 · Değerlendirme kaydının türü

- **Kural:** Her resmî not kaydı şunları taşır: öğrenci, ders, dönem (1/2), tür ve aynı türdeki sıra numarası, tarih, puan ya da özel durum, giren öğretmen. Tür `sinav` (yazılı/uygulamalı), `performans`, `proje` veya `katilim` (yalnız ortaokul) olabilir. Özel durumlar `K` (kopya) ve `G` (girmedi/teslim etmedi) puan değildir. "Hazırbulunuşluk", "kazanım testi", "aylık değerlendirme" gibi kurum içi ölçmeler resmî not türü değildir; dönem puanına girmez (`DOM-AKD-060`).
- **Gerekçe:** Dönem puanı formülü türlere göre ayrı ortalama alır; türsüz not listesinden resmî puan hesaplanamaz.
- **Kaynak:** OİKY md. 22, 23/4, 27/2; OKY md. 44/1, 48/4, 51/1.
- **Kurum türü:** `school`
- **Kodda:** kısmen — `packages/school-core/src/lib/grades.ts` (`recordGrade`, `updateGrade`) tür, dönem, sıra, tarih, puan, giren öğretmeni ve notun verildiği sınıfı (`classId`) yazar; düzeltme eski puanı gerekçesiyle `corrections` geçmişinde saklar; notlu quiz tek kayıt olarak ilk tamamlanan denemeden aktarılır. Çelişen kısım: `K`/`G` özel durumları yok; örnek notların türü serbest başlıktır (`packages/school-core/src/data/seed.ts`), dönem ve sıra yoktur; Vue demosunda quiz denemesi doğrudan not olur (`apps/web/src/views/Learning.vue`).

## Ortaokul ölçme (OİKY)

### DOM-AKD-010 · Ortaokul dönem puanı

- **Kural:** Bir dersin dönem puanı şöyle hesaplanır:
  `D = ( (ort(proje) + ort(katılım)) / 2 + S1 + S2 ) / 3`
  Formüldeki `S1` ve `S2` dönemin birinci ve ikinci sınav puanıdır. Projenin hazırlatılmadığı dönemde proje terimi bulunmaz. Bu durumda formülün e-Okul'daki uygulanışı doğrulanana kadar sistem dönem puanını "hesaplanamadı" olarak işaretler ve yöneticiden e-Okul değerini ister. Kendi tahminini resmî puan gibi göstermez.
- **Gerekçe:** Resmî formüldür; proje olmayan dönem için mevzuat metni açık değildir.
- **Kaynak:** OİKY md. 27/2-a. Dönem başına iki sınav OİKY md. 27/2-a'dan çıkarılmıştır; sınav sayısı ve proje olmayan dönem hesabı ÖDY'de **doğrulanmalı**.
- **Kurum türü:** `school`
- **Kodda:** yok — not ortalaması düz aritmetik ortalamadır (`apps/web/src/stores/demo.js:197`).

### DOM-AKD-011 · Ders etkinliklerine katılım puanı sayısı

- **Kural:** Ortaokulda her dönem her dersten, haftalık ders saati 2 ve altındaysa 2, 2'den fazlaysa 3 katılım puanı verilir. Eksik katılım puanı olan dersin dönem puanı kesinleşmez; öğretmene eksik listesi gösterilir. Rehberlik ve sosyal etkinlikler puanlanmaz.
- **Gerekçe:** Formülün girdisi sayıca tamamlanmadan dönem puanı yanlış çıkar.
- **Kaynak:** OİKY md. 22/3, 22/4.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-012 · Ortaokul projesi

- **Kural:** Her ortaokul öğrencisi ders yılında istediği bir veya birkaç dersten, bireysel ya da grup olarak, en az bir proje hazırlar. Proje hazırlatıldığı dönemde değerlendirilir. Teslim etmeyen öğrencinin proje puanı 0'dır. Özrü kabul edilen öğrenciye öğretmen yeni teslim süresi verir. Sistem, yıl içinde proje ataması olmayan öğrenciyi ikinci dönem başında sınıf rehber öğretmenine listeler. Proje değerlendirmesinde kullanılan dereceli puanlama ölçeği bir yıl saklanır.
- **Gerekçe:** Projesi olmayan öğrencinin dönem puanı hesaplanamaz veya 0 alır.
- **Kaynak:** OİKY md. 22/2 (RG 28/7/2026 değişikliği: teslim etmeyene 0), 23/2, 25/2. OİKY md. 23/4'teki "projesini zamanında teslim etmeyene G" hükmü ile md. 22/2'nin ilişkisi **doğrulanmalı**; sonraki tarihli 22/2 esas alındı.
- **Kurum türü:** `school`
- **Kodda:** yok — ödev teslimi var (`apps/web/src/views/Learning.vue:222-248`), proje türü ve zorunluluğu yok.

### DOM-AKD-013 · Sınava katılmama ve kopya (iki kademe)

- **Kural:** Kopya çeken öğrencinin sınavı `K`, geçerli özrü olmadan sınava girmeyen veya çalışmasını teslim etmeyen öğrencininki `G` olarak işlenir. Her ikisi puan değildir ama ortalamada sayıya dahil edilir; sonuçta 0 gibi etki eder. Sınava katılamama veliye bildirilir. Veli özrünü ortaokulda 5 iş günü içinde yazılı bildirir, lisede özür belgesini `DOM-AKD-032` süresinde verir. Özrü kabul edilen öğrenci mazeret sınavına bir kez alınır; mazeret sınavı ilgili dönemi aşamaz. Raporlu veya izinli gün sınav yapılmaz.
- **Gerekçe:** `K`/`G` puansız ama hesaba katılan özel durumlardır; boş bırakılırsa ortalama yükselir.
- **Kaynak:** OİKY md. 22/1-b, 23/1-2, 23/4; OKY md. 48/1, 48/4, 48/5.
- **Kurum türü:** `school`
- **Kodda:** yok — not kaydı yalnız 0–100 tam sayı puan saklar (`gradeRecordSchema`); `K`/`G` değeri yok. Yönetim ortalaması sorgusunda `TODO(kg-not)` bırakıldı: saklanmaya başlayınca `K`/`G` 0 sayılacak.

## Lise ölçme (OKY)

### DOM-AKD-020 · Lise yazılı ve uygulamalı sınavları

- **Kural:**
  - **Sınav sayısı:** Her dönem her dersten iki yazılı sınav yapılır. Haftalık 6 ve üstü saatli derste il zümre kararı varsa üçüncü sınav yapılabilir; karar kaydı olmadan üçüncü sınav açılamaz.
  - **İlan:** Sınav tarihleri önceden ilan edilir.
  - **Günlük sınır:** Bir sınıfta bir günde en fazla iki sınav planlanır. Üçüncüsü yalnız "zorunlu hâl" gerekçesiyle girilebilir.
  - **Süre:** Sınav süresi zorunlu hâl dışında bir ders saatini geçmez.
  - **Cevap anahtarı:** Sınavdan önce soru başına puanla hazırlanır ve saklanır.
  - **Dil sınavları:** Yabancı dil ve Türk dili ve edebiyatı sınavlarının her biri dinleme, konuşma, okuma ve yazma becerilerini ölçer. İngilizce beceri modülü bu sınavların bileşenlerini üretebilir (`DOM-BEC`).
- **Gerekçe:** Sınav takvimi çakışması ve sınav yığılması en sık veli şikâyetidir; mevzuat bunları sınırlar.
- **Kaynak:** OKY md. 45/1-a, ç, e, g, h.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-021 · Lise performans, proje ve sosyal sorumluluk

- **Kural:** Lisede her dönem tüm derslerden iki performans puanı verilir. Birincisi performans çalışmasına, ikincisi derse hazırlık, katılım, okuma ve davranış gibi göstergelere dayanır. Zümre kararıyla üçüncü bir performans puanı verilebilir ve öğrencilere duyurulur. Öğrenci her ders yılında en az bir dersten proje hazırlar; dersi sınıf rehber öğretmeni yönetime bildirir. Ulusal veya uluslararası yarışma başarısı ilgili dersin proje veya performansı olarak tam puanla değerlendirilebilir. Sosyal sorumluluk çalışması ortaöğrenim boyunca en az 40 saattir (meslekî programlarda 20). Puanlanmaz, mezuniyette belgelendirilir. Özürsüz her devamsızlık günü bu süreye bir saat ekler.
- **Gerekçe:** Dönem puanı formülünün girdileridir; 40 saat mezuniyet belgesinin koşuludur.
- **Kaynak:** OKY md. 50/1, 50/2, 50/3, 50/7, 50/8 (RG 22/2/2025 değişikliği), 36/5-a.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-022 · Lise dönem puanı

- **Kural:** Bir dersin lise dönem puanı, şu bileşenlerin aritmetik ortalamasıdır: sınav puanlarının ortalaması, performans puanlarının ortalaması ve varsa proje puanı. Örneğin projesiz derste `D = (ort(sınav) + ort(performans)) / 2`, projeli derste `D = (ort(sınav) + ort(performans) + proje) / 3`. Her dersten dönem başına bir dönem puanı oluşur. 60 günlük özürlü devamsızlık kapsamındaki öğrencinin dönem puanı zorunlu hâlde bir sınav eksiğiyle verilebilir.
- **Gerekçe:** Resmî formüldür; proje bir bileşen olarak ağırlığı yüksektir.
- **Kaynak:** OKY md. 51/1-a, b, c, e ve 51/2, 51/3.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-023 · Yılsonu puanı, ağırlık ve yılsonu başarı puanı (iki kademe)

- **Kural:** Bir dersin yılsonu puanı iki dönem puanının aritmetik ortalamasıdır. Dersin ağırlığı haftalık ders saatidir; ağırlıklı puan `yılsonu puanı × haftalık saat` ile bulunur. Yılsonu başarı puanı (YBP) `Σ ağırlıklı puan / Σ haftalık saat` ile hesaplanır. Naklen gelen lise öğrencisinde payda, yeni okuldaki haftalık ders saati toplamıdır. Lisede sorumluluk sınavına giren öğrencinin dersin yılsonu puanı, eski yılsonu puanı ile sorumluluk sınavı puanının ortalamasıdır. Haftalık saatler sınıfın ders çizelgesinden gelir, nota elle girilmez.
- **Gerekçe:** Düz ortalama, 6 saatlik matematik ile 1 saatlik dersi eşit sayar ve resmî YBP'den sapar.
- **Kaynak:** OİKY md. 27/3-4, 28/1; OKY md. 53/1-d, 54, 55/1.
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — `apps/web/src/stores/demo.js:197` (`gradeAverage`) tüm notların ağırlıksız düz ortalamasını gösterir.

### DOM-AKD-024 · Lise ders başarısı ve derece

- **Kural:** Lisede bir dersten yıl sonunda başarılı sayılmak için iki dönem puanının ortalaması en az 50 olmalı ya da birinci dönem ne olursa olsun ikinci dönem puanı en az 70 olmalıdır. Derece gösterimi: 85,00–100 Pekiyi, 70,00–84,99 İyi, 60,00–69,99 Orta, 50,00–59,99 Geçer, 0–49,99 Geçmez. Ortaokulda başarı eşiği Türkçe için 70,00, diğer dersler için 50,00'dır.
- **Gerekçe:** Eşikler ve "ikinci dönem 70" istisnası sınıf geçme kararının girdisidir.
- **Kaynak:** OKY md. 44/2, 56/1-a; OİKY md. 21/1, 28/2.
- **Kurum türü:** `school`
- **Kodda:** yok — analiz ekranı kazanım için 65/80 renk eşikleri kullanır (`apps/web/src/views/Academic.vue:457-529`). Bunlar işletme göstergesidir ve resmî başarı eşiğiyle karıştırılmamalıdır.

## Devamsızlık

### DOM-AKD-030 · Yoklama ders saati bazında alınır

- **Kural:** Yoklama her ders saati için ders öğretmenince alınır: `Geldi`, `Gelmedi`, `Geç geldi`, `Faaliyet izinli`. Gün değeri (tam, yarım, yok) ders saatlerinden türetilir ve saklanmaz. Gelmeyen öğrencinin durumu okul yönetimine, yönetimden veliye ivedi bildirilir (`DOM-AKD-033`). Yoklama ders programındaki gerçek ders saatleri için alınır. İptal edilen ders, tatil ve gelecek tarih için yoklama alınmaz.
- **Gerekçe:** Mevzuat derse girmemeyi de devamsızlık sayar; gün bazlı tek durum yarım günü ifade edemez.
- **Kaynak:** OİKY md. 18/1, 18/3-b; OKY md. 36/2-a.
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — `packages/school-core/src/lib/domain.js:50-74` (`recordAttendance`) öğrenci başına günde tek durum yazar; gelecek tarih engeli var (`53`).

### DOM-AKD-031 · Tam gün, yarım gün ve geç kalma

- **Kural:**
  - **Ortaokul:** Okula hiç gelmeyen tam gün devamsız sayılır. Okula gelip bir veya daha fazla derse özürsüz girmeyen yarım gün sayılır.
  - **Lise, gün hesabı:** Günlük toplam ders saatinin 2/3'üne veya fazlasına gelmeyen bir gün, diğerleri yarım gün devamsız sayılır.
  - **Lise, geç kalma:** Geç gelme yalnız birinci ders saati için öğretmenler kurulunun belirlediği süre içinde geçerlidir. Her 5 geç kalma yarım gün devamsızlıktır. Süre dışındaki geç gelme devamsızlıktır.
  - **Ortaokulda geç kalma:** OİKY'de geç kalmanın devamsızlığa çevrildiği bir hüküm bulunamadı. Profilde `lateToAbsence` parametresi bu kademede kapalıdır. Geç kalma kaydedilir ve veliye gösterilir.
- **Gerekçe:** Devamsızlık sınırları gün cinsindendir; birim yanlış türetilirse öğrenci haksız yere sınırı aşar veya aşmaz.
- **Kaynak:** OİKY md. 18/3-b; OKY md. 35/1, 36/2-b. Ortaokulda geç kalma hükmünün yokluğu **doğrulanmalı** (ÖDY ve e-Okul uygulaması).
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — `apps/web/src/stores/demo.js:198-199` (`absentCount`) yalnız `absent` sayar; `late` hiçbir zaman devamsızlığa dönüşmez, yarım gün yok.

### DOM-AKD-032 · Özürlü, özürsüz ve izin

- **Kural:** Devamsızlık kaydedildiğinde özürsüzdür. Özür belgesi veya yazılı veli beyanı, özür gününü izleyen iş günlerinden itibaren süre içinde verilirse özürlüye çevrilir. Süre ortaokulda 3, lisede 5 iş günüdür. Zorunlu hâlde okul yönetimi süreyi gerekçe yazarak en fazla 20 iş gününe uzatır. Süre geçince kayıt özürsüz kalır. Veli izin bildirimi (`DOM-ILT`) yönetimce onaylanınca ilgili ders saatlerine özürlü veya izinli olarak bağlanır. Geçmiş tarihli bildirim de bu süre içinde kabul edilir. Ortaokulda geçerli mazeret ve veli başvurusuyla yılda 15 güne kadar izin verilebilir. Lisede Bakanlık, valilik veya MEM izinli faaliyetler ile okul müdürünün verdiği faaliyet izinleri devamsızlıktan sayılmaz. Faaliyet izinleri yılın 2/3'ünü aşamaz.
- **Gerekçe:** Özür belgesinin süresi ve bağlandığı gün sınıf geçmeyi doğrudan etkiler.
- **Kaynak:** OİKY md. 18/3-d, 18/3-f, 18/3-g; OKY md. 36/3, 36/7.
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — `excused` durumu var (`packages/school-core/src/lib/domain.js:56`) ama belge ve süre yok. Veli izin bildirimi geçmiş tarihi engeller ve yoklamaya bağlanmaz (`apps/web/src/views/Communication.vue:322-323`).

### DOM-AKD-033 · Devamsızlıkta veli bildirimi

- **Kural:**
  - **Ortaokul:** Özürsüz devamsızlık 5, 10 ve 15 güne ulaşınca veliye posta, bilgi-iletişim aracı veya SMS ile bildirim yapılır. Özel gruplar (sürekli tedavi, kaynaştırma, koruma altı) için 30. günde ayrıca tebligat yapılır.
  - **Lise:** Art arda iki gün özürsüz devamsızlıkta veliye bildirim yapılır ve veli okula davet edilir. Devamsızlığın 5., 15. ve 25. gününde tebligat yapılır. Özel gruplar için 40. ve 55. günde de tebligat yapılır.
  - **Kayıt:** Her bildirim tetikleyen eşik, kanal, alıcı, zaman ve teslim sonucuyla kaydedilir. Aynı eşik için ikinci bildirim gitmez.
  - **Nitelik:** Bildirim hizmet iletisidir. Resmî tebligatı okul yönetimi yapar. Platform bildirimi tebligatın yerine geçmez; tebligatın yapıldığı ayrıca işaretlenir.
- **Gerekçe:** Bildirim günleri mevzuatla belirlenmiştir; kaydı yoksa okul yükümlülüğünü ispat edemez.
- **Kaynak:** OİKY md. 18/3-b, 18/3-e (RG 28/7/2026 değişikliği); OKY md. 36/4, 36/6. OKY'de 5/15/25 günlerin toplam mı özürsüz mü devamsızlığa göre sayıldığı metinde açık değil ("devamsızlığın"); toplam devamsızlık esas alındı, **doğrulanmalı**.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-034 · Devamsızlık sınırları

- **Kural:**
  - **Lise sınırı:** Özürsüz 10 günü veya toplam 30 günü aşan öğrenci, ders puanları ne olursa olsun başarısız sayılır ve veliye yazılı bildirilir.
  - **Lise istisnaları:** Birinci derece yakınını kaybeden öğrencide toplam sınır 40 gündür. Sürekli veya yatarak tedavi gören, koruma altındaki ve tutuklu öğrencide 60 gündür. Kaynaştırma ve özel eğitim meslek lisesi öğrencisinde 70 gündür ve özürsüz sınırı 20'ye çıkar. İstisnaya giren durum belgeye bağlanır.
  - **Ortaokul:** Özürsüz 20 gün ve üstü devamsızlık öğrenciyi şube öğretmenler kurulu kararına götürür (`DOM-AKD-040`).
  - **Uyarılar:** Sistem sınıra yaklaşan öğrenciyi yöneticiye ve sınıf rehber öğretmenine uyarır. Uyarı eşiği kurum ayarıdır (varsayılan sınırın %70'i). Lisede önleme, müdahale ve yönlendirme komisyonu için 5. gün daveti hatırlatılır.
- **Gerekçe:** Sınırı aşmak sınıf tekrarı demektir; erken uyarı müdahale fırsatı verir.
- **Kaynak:** OKY md. 36/5-a, b (RG 22/2/2025 değişikliği); OİKY md. 31/2-b.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-035 · Yoklama düzeltmesi geçmişi korur

- **Kural:**
  - **Geçmiş:** Kaydedilmiş yoklama üzerine iz bırakmadan yazılmaz. Durum değişince kayda düzeltme satırı eklenir: eski durum, yeni durum, gerekçe, düzelten kişi ve zaman. Durumu değişmeyen öğrenciye satır eklenmez; ilk kez alınan yoklama geçmiş taşımaz.
  - **Kim düzeltir:** Öğretmen ders verdiği sınıfın yoklamasını aynı gün alır ve düzeltir; gerekçe isteğe bağlıdır. Sonraki günlerde düzeltmeyi yalnız müdür yardımcısı veya yönetici yapar; gerekçe zorunludur (en az 2 karakter, en çok 500).
  - **Aynı gün güncellemesi:** Öğretmenin aynı gün içindeki her durum değişikliği de geçmişe yazılır. Tasarım kararı: "yoklamayı aldıktan sonra fikir değiştirme" ile "düzeltme" arasında ayrım yapılmaz; ayrım için ikinci bir süre kuralı gerekirdi ve itirazda iz bulunmazdı.
  - **Görünürlük:** Veli ve öğrenci yalnız güncel durumu görür. Düzeltme geçmişi (gerekçe metni, düzelten kişi) onlara gönderilmez. Öğretmen ve yönetici kendi kapsamında görür. Denetim kaydına geçmişin içeriği değil, değişen alanın adı yazılır.
  - **Atomiklik:** Bir sınıfın yoklaması tek işlemdir. Bir işaret veya gerekçe geçersizse hiçbir öğrencinin kaydı ve geçmişi değişmez.
  - **Tekillik:** Aynı öğrenci ve ders saati için tek geçerli kayıt bulunur.
- **Gerekçe:** Devamsızlık resmî sonucu olan bir kayıttır; iz bırakmadan değişmesi itiraz ve denetimde savunulamaz. Gerekçe ve düzelten kişi personelin iç bilgisidir; veliye giden bilgi güncel durumdur.
- **Kaynak:** İşletme kuralı; e-Okul'a günlük işleme OİKY md. 18/1.
- **Kurum türü:** `school`
- **Kodda:** kısmen — `packages/school-core/src/lib/domain.ts` (`recordAttendance`) düzeltmeyi kaydın `corrections` geçmişine yazar; yetki `lib/authorize.ts` (`attendance.record`), ayıklama `lib/scope.ts` (`HIDDEN_FIELDS`). Çelişen kısım: tekillik ders saati değil gün bazındadır (`DOM-AKD-030`).

## Sınıf geçme

### DOM-AKD-040 · Sınıf geçme kararı

- **Kural:** Her öğrenci için eğitim yılı sonunda tek bir **sınıf geçme kararı** kaydı oluşur.
  - **Karar türleri:** `Geçti`, `Sorumlu geçti` (lise; sorumlu ders listesiyle), `Şube öğretmenler kurulu kararıyla geçti` (ortaokul), `Sınıf tekrarı`, `Devamsızlıktan başarısız` (lise).
  - **Kayıt içeriği:** karar türü, girdiler (dönem puanları, YBP, başarısız dersler, devamsızlık), profil sürümü (`DOM-AKD-001`), karar tarihi, kararı kesinleştiren yönetici ve varsa kurul tutanağının numarası.
  - **Ortaokul kuralı:** Özürsüz devamsızlığı 20 gün ve üstü olan, Türkçe yılsonu puanı 70,00'ın altında olan veya herhangi bir dersin yılsonu puanı 50,00'ın altında olan öğrenci için sistem karar vermez. Bu öğrenciler için ikinci dönemin son haftasında şube öğretmenler kurulunun gerekçeli kararı (EK-5) girilir. Kurul kararıyla geçen öğrencinin puanları değiştirilmez; karara ait ibare karnede gösterilir. Diğer öğrenciler `Geçti` olur.
  - **Lise kuralı:** Önce devamsızlık sınırına bakılır; sınırı aşan öğrenci `Devamsızlıktan başarısız` olur. Sonra her dersten iki dönem puanı bulunması şartıyla:
    - Tüm dersleri başarılı olan, ya da en fazla 1 dersten başarısız olup YBP'si en az 50 olan öğrenci doğrudan geçer. Başarısız dersi varsa o dersten sorumlu olur.
    - Değilse, YBP'si en az 50 olup bulunduğu sınıfta en fazla 3 dersten başarısız olan öğrenci `Sorumlu geçti` olur.
    - Alt sınıflar dahil toplam 6'dan fazla başarısız dersi olan öğrenci sınıf tekrar eder. Nakil ve geçişten gelen sorumlu dersler bu sayıya girmez.
    - Kalan durumlar `Sınıf tekrarı` olur.
  - **Özel eğitim:** Tam zamanlı kaynaştırma veya özel eğitim sınıfındaki ortaokul öğrencisine başarısızlık nedeniyle sınıf tekrarı yaptırılmaz.
  - **Kesinleşme ve sonrası:** Karar yalnız yönetici onayıyla kesinleşir ve veliye bildirilir. Dönem geçişi (`DOM-KAY-020`) ve yenileme hedef düzeyi (`DOM-KAY-021`) bu karara bağlıdır. Kesinleşmiş karar değiştirilemez; düzeltme gerekçeli yeni karar sürümüyle yapılır.
  - **Resmî karar:** Platform kararı e-Okul kararının ön hesabıdır; iki karar ayrışırsa e-Okul esas alınır ve fark yöneticiye gösterilir.
- **Gerekçe:** Sınıf geçme, kayıt yenileme, dönem geçişi ve iadenin ortak girdisidir. Kurul kararı gereken durumu otomatik karara bağlamak mevzuata aykırıdır.
- **Kaynak:** OİKY md. 28/2, 31/2-b, c, 31/3; OKY md. 36/5, 56, 57, 58/1.
- **Kurum türü:** `school`
- **Kodda:** yok — dönem geçişi karar denetimi yapmadan öğrenciyi üst düzeye taşır (`packages/school-core/src/lib/school-workflows.js:846-927`).

### DOM-AKD-041 · Lise sorumlu ders takibi

- **Kural:** `Sorumlu geçti` kararındaki her ders, öğrencinin sorumlu ders listesine eklenir: ders, düzey, eğitim yılı. Sorumluluk sınavları birinci dönemin ilk iki haftası ile ikinci dönemin ilk ve son iki haftası içinde planlanır. Sorumluluk sınavı iki öğretmen ve bir gözcüyle yapılır. Sorumluluk sınavı sonucuyla dersin yılsonu puanı `DOM-AKD-023` ile yeniden hesaplanır; ders başarılı olunca sorumluluk kalkar. Açık sorumlu ders sayısı bir sonraki sınıf geçme kararına girdi olur.
- **Gerekçe:** Sorumlu ders unutulursa öğrenci toplam 6 sınırını fark etmeden aşar.
- **Kaynak:** OKY md. 53/1-d, 58/1, 58/2-a.
- **Kurum türü:** `school`
- **Kodda:** yok.

## Karne, rapor ve ödül

### DOM-AKD-050 · Karne ve gelişim raporu

- **Kural:** Karne her dönem sonunda, o dönemin kesinleşmiş puan çizelgesinden üretilir. Karnede dönem puanları, devamsızlık (özürlü/özürsüz, gün), varsa kurul kararı ibaresi ve ödül belgesi yer alır. Dağıtılmış karne geri alınmaz ve sürümü değişmez; düzeltme ayrı bir düzeltme belgesiyle yapılır. Ortaokulda 2025–2026'dan itibaren 5. sınıftan başlayarak kademeli olarak, karneyle birlikte öğretmen görüşü, devam durumu, gelişim düzeyi ve sosyal-duygusal becerileri içeren Gelişim Raporu verilir. Hangi düzeyin kapsamda olduğu profil parametresidir. Platform belgesi "bilgilendirme amaçlıdır" ibaresi taşır; resmî karne e-Okul/e-Karne'dir.
- **Gerekçe:** Karne resmî belgedir; platformun ürettiği belge resmî belgeyle karıştırılmamalıdır.
- **Kaynak:** OİKY md. 30/2-b, c (RG 28/7/2026 değişikliği), 31/2-c.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-051 · Öğretmen puan çizelgesinin kesinleşmesi

- **Kural:** Dönem bitmeden beş gün önce, o dönemin ders puan çizelgesi öğretmen ve okul yönetimince kontrol edilip müdür onayıyla kesinleşir. Kesinleşmiş çizelgede not değişikliği yalnız gerekçeli düzeltme talebi ve yönetici onayıyla yapılır; eski değer saklanır. Eksik puanı olan çizelge (`DOM-AKD-011`, `DOM-AKD-021`) kesinleşemez.
- **Gerekçe:** Karne ve sınıf geçme kesinleşmiş puanlara dayanmalıdır.
- **Kaynak:** OİKY md. 26/1. Lisede aynı kesinleşme süresi işletme kuralıdır.
- **Kurum türü:** `school`
- **Kodda:** kısmen — düzeltme eski puanı gerekçe ve düzeltenle `corrections` geçmişinde saklar (`packages/school-core/src/lib/grades.ts`, `updateGrade`); öğrenci ve veli geçmişi görmez (`lib/scope.ts`). Çizelge kesinleşmesi ve onaylı düzeltme talebi yok.

### DOM-AKD-052 · Teşekkür ve takdir belgesi

- **Kural:**
  - **Ortaokul:** Türkçeden 70,00, diğer derslerin her birinden 50,00'ın altında puanı olmamak şartıyla dönem ağırlıklı puan ortalaması 70,00–84,99 olan "Teşekkür", 85,00 ve üstü olan "Takdir" alır.
  - **Lise:** Tüm derslerden başarılı, dönem puanlarının ağırlıklı ortalaması 70,00'ın altında olmayan ve davranış puanı 100 olan öğrenci 70,00–84,99 aralığında teşekkür, 85,00 ve üstünde takdir alır. Ortaöğrenim boyunca en az üç öğretim yılının bütün dönemlerinde takdir alan "Üstün başarı" belgesi alır. Davranış puanı lisede ayrı bir kayıttır.
  - **Engel:** Devamsızlık sınırını dolduran lise öğrencisi belge alamaz.
  - **Yetki:** Belgeyi sistem önerir; lisede okul öğrenci ödül ve disiplin kurulu, ortaokulda okul yönetimi kesinleştirir.
- **Gerekçe:** Ödül eşiği ağırlıklı ortalamaya ve ders bazlı alt sınırlara bağlıdır; düz ortalama yanlış öğrenciye belge verir.
- **Kaynak:** OİKY md. 53/1; OKY md. 36/5-b, 160/1.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-053 · Sonuçların duyurulması ve itiraz

- **Kural:** Sınav sonuçları sınav tarihinden, proje ve performans sonuçları teslim tarihinden itibaren en geç 10 iş günü içinde girilir ve öğrenci/veliye yayımlanır. Süreyi aşan değerlendirme öğretmene ve yöneticiye uyarı olur. Öğretmen notu girdikten sonra "yayımla" ile görünür kılar; yayımlanmamış not veli ve öğrenciye görünmez. Lisede veli, sonuç ilanını izleyen 5 iş günü içinde yazılı itiraz eder. İtirazı ders öğretmeni dışındaki en az iki branş öğretmeninden oluşan komisyon inceler. İtiraz kaydı, komisyon ve sonuç saklanır. Sınav kâğıdı bir yıl saklanır.
- **Gerekçe:** Süre ve itiraz hakkı mevzuattadır; yayımsız not kavramı yarım girilmiş notun veliye yansımasını önler.
- **Kaynak:** OİKY md. 25/1; OKY md. 49/2, 49/4. Ortaokulda sonuçlara itiraz usulü (ÖDY) **doğrulanmalı**. Yayım adımı işletme kuralıdır.
- **Kurum türü:** `school`
- **Kodda:** yok.

### DOM-AKD-054 · Not ve devamsızlık kapsamı

- **Kural:**
  - **Giriş:** Öğretmen yalnız atandığı sınıf ve branşta not ve yoklama girer. Sınıf rehber öğretmeni kendi şubesinin bütün derslerini salt okur görür.
  - **Not düzeltme:** Yetki notun verildiği sınıfa göre belirlenir: notta saklanan sınıf ve dersin branşı. Öğrencinin güncel sınıfına bakılmaz. Sınıf değiştiren öğrencinin eski notunu notu veren sınıfın ders öğretmeni düzeltir; yeni sınıfın öğretmeni notu görür ama düzeltemez. Sınıfı saklanmamış eski kayıtta öğrencinin güncel sınıfı esas alınır. Yönetici her durumda gerekçeyle düzeltir.
  - **Veli ve öğrenci:** Veli yalnız kendi çocuklarının, öğrenci yalnız kendisinin yayımlanmış notunu ve devamsızlığını görür. Yalnız güncel değer gösterilir; düzeltme geçmişi (gerekçe, düzelten kişi) gösterilmez.
  - **Kimlik:** Kurum kimliği ve öğretmen kimliği oturumdan gelir; istemcinin gönderdiği öğretmen kimliğine güvenilmez.
- **Gerekçe:** Not ve devamsızlık kişisel veridir; başka branşın notunu değiştirmek ölçme güvenliğini bozar.
- **Kaynak:** İşletme kuralı; KVKK md. 12; ADR 0001 karar 7.
- **Kurum türü:** `school`
- **Kodda:** kısmen — okuma kapsamı `packages/school-core/src/lib/scope.ts` (`scopeFor`, not için notun sınıfı da kapsam verir), yazma yetkisi `lib/authorize.ts` (`grade.record`, `grade.update`, `attendance.record`); API oturumu üyelik bağlantılarından gelir. Çelişen kısım: yayım adımı yok (`DOM-AKD-053`); çevrimdışı demo öğretmeni sabit `t1` kimliğine eşlenir (`sessionActor`).

## Quiz

Quiz, öğretmenin soru bankasından hazırladığı, otomatik puanlanan kısa ölçmedir; sonucu resmî not değildir, dönem puanına ancak `DOM-AKD-060` ile ve açıkça aktarılarak girer. Kayıtlar `quizzes` ve `quizAttempts` koleksiyonlarındadır; modül `learning`, kapalıysa quiz uçları kapanır (`DOM-YTK-040`). İçerik havuzundaki quiz kaynağı (ADR 0004, `resources`) ayrı kuraldır (`DOM-KYN`).

### DOM-AKD-075 · Quiz hazırlama

- **Kural:** Quizi yönetici ya da sınıfın o dersine atanmış öğretmen hazırlar. Öğretmen yalnız derse girdiği sınıf ve branşa hazırlar; sınıfa tek dersle giriyorsa ders seçilmez. Quizin öğretmeni sınıfın o dersine atanmış aktif öğretmendir; atama yoksa quiz hazırlanmaz. Pasif ya da arşivlenmiş sınıfa quiz hazırlanmaz. Sorular kurumun soru bankasından seçilir (en az 1, en çok 50, her soru bir kez): bankada olmayan soru ve quizin dersi ya da sınıfın düzeyi dışındaki soru reddedilir. Çözme süresi 5–120 dakikadır. Son tarih isteğe bağlıdır; saat dilimli an olarak girilir, UTC saklanır ve verildiği anda geçmişte olamaz. Ön büro quiz görmez ve yazmaz (`DOM-YTK-021`).
- **Gerekçe:** Branş ya da düzey dışı soru, öğrencinin işlenmemiş konudan ölçülmesine yol açar; bankada olmayan soru puanlanamaz.
- **Kaynak:** İşletme kuralı; öğretmenin kapsamı `DOM-YTK-022`. Vue demosu aynı ders ve düzey denetimini yapar (`apps/web/src/views/Learning.vue:363-404`).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/quiz.ts` (`createQuiz`), yetki `lib/authorize.ts` (`quiz.create`).

### DOM-AKD-076 · Quiz düzenleme ve arşiv

- **Kural:** Quizi yönetici ya da sınıfın o dersine atanmış öğretmen düzenler: başlık, süre, son tarih ve sorular. Sınıf ve ders değişmez; yanlış sınıfa hazırlanan quiz arşivlenip yeniden hazırlanır. Deneme kaydı olan (başlatılmış ya da tamamlanmış) quizin soruları değişmez ve quiz arşivlenmez. Süre ve son tarih değişikliği yalnız sonraki denemeleri etkiler; başlamış denemenin bitiş anı korunur. Quizi gören (aynı sınıfa giren ya da dersten alınmış eski) başka öğretmen düzenleyemez; görmeyen için quiz yoktur. Ders öğretmeni değişince deneme kaydı olmayan quiz yeni öğretmene geçer (`DOM-YTK-022`).
- **Gerekçe:** Çözülmüş quizin sorusunu değiştirmek verilmiş cevapları anlamsızlaştırır ve puanı geriye dönük değiştirir; arşiv öğrencinin sonucunu ve aktarılmış notun kaynağını siler.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `lib/quiz.ts` (`updateQuiz`, `archiveQuiz`).

### DOM-AKD-077 · Quiz çözme: tek deneme, süre ve son tarih

- **Kural:** Öğrenci yalnız kendi sınıfının quizini çözer; pasif öğrenci çözmez. Her öğrencinin quiz başına tek denemesi vardır. Deneme başlatılınca süre işler: bitiş anı başlangıç + süredir, son tarih daha erkense son tarihtir. Başlamış deneme yeniden açılınca aynı deneme ve aynı bitiş anı döner (yenileme süreyi baştan başlatmaz). Son tarihten sonra deneme başlatılmaz. Cevaplar bitiş anından sonra en çok 60 saniyelik ağ payı içinde kabul edilir; payı aşan gönderim reddedilir ve deneme boş cevaplı sonucuyla (0) kalır. Boş bırakılan soru yanlış sayılır. Gönderilmiş ya da süresi dolmuş denemeden sonra ikinci deneme ve ikinci gönderim reddedilir (409); ağ yinelemesi aynı `Idempotency-Key` ile ilk yanıtı alır. `DOM-AKD-060`'taki tekrar çözme ve "ilk tamamlanan deneme" eski kayıtlar içindir.
- **Gerekçe:** Süre istemcide tutulursa sayfa yenilemesiyle uzatılabilir; tekrar gönderim sonucu iyileştirmeye ve cevabı arkadaştan öğrenip yeniden çözmeye izin verir. İkinci gönderimin sessizce ilk sonucu döndürmesi, yeni cevapların puanlandığı yanılgısını doğurur.
- **Kaynak:** İşletme kuralı. Vue demosunda süre yalnız önerilir ve quiz tekrar çözülür (`apps/web/src/views/Learning.vue:405-436`).
- **Kurum türü:** ikisi
- **Kodda:** var — `lib/quiz.ts` (`startQuiz`, `submitQuiz`, `quizAttemptStatus`); nota aktarım süresi işleyen denemeyi saymaz (`lib/grades.ts`).

### DOM-AKD-078 · Sunucu puanlaması ve cevap anahtarının gizliliği

- **Kural:** Puan yalnız öğrencinin gönderdiği cevaplardan, soru bankasındaki anahtarla sunucuda hesaplanır; istemciden puan, doğru sayısı ya da sonuç alınmaz. Gösterilen sonuç her okumada cevaplardan yeniden hesaplanır; kayıttaki sonuç alanları eski görünümler için yazılan kopyadır. Cevap anahtarı (doğru şık) ve çözüm açıklaması öğrenci ve veliye hiçbir yanıtta dönmez; yalnız yönetici ve öğretmen bankadan okur. Öğrenci soru metnini ve şıklarını deneme başlatınca görür; veli çocuğunun denemesi sonuçlanınca görür. Deneme sonuçlanınca (gönderilmiş ya da süresi dolmuş) öğrenci ve veliye puan, doğru ve soru sayısı, konu yüzdeleri ve öğrencinin kendi cevapları açılır; soru bazında doğru/yanlış işareti açılmaz. Süre işlerken sonuç da cevaplar da dönmez.
- **Gerekçe:** Doğru şık ya da soru bazında doğru/yanlış, quizi henüz çözmemiş sınıf arkadaşına anahtarı taşır. Konu yüzdesi kazanım analizinin amacıdır (`DOM-AKD-060`).
- **Kaynak:** İşletme kuralı. Vue demosu çözümden sonra doğru şıkkı ve açıklamayı gösterir (`apps/web/src/views/Learning.vue:976-997`); bilinçli olarak değiştirildi.
- **Kurum türü:** ikisi
- **Kodda:** var — `lib/quiz.ts` (`quizQuestionsView`, `quizAttemptResult`, `quizAttemptView`, `canSeeQuizQuestions`); soru bankası öğrenci ve veliye okunmaz (`platform/scope.ts` `bank`).

### DOM-AKD-079 · Quiz ortalaması ve görünürlük

- **Kural:** Quiz ortalaması saklanmaz; her okumada sonuçlanmış denemelerin cevaplardan hesaplanan puanlarıyla bulunur ve tam sayıya yuvarlanır. Süresi işleyen deneme ortalamaya girmez; süresi dolmuş deneme 0 ile girer. Eski kayıtta öğrencinin birden çok denemesi varsa ilk deneme sayılır (`DOM-AKD-060`). Deneme yoksa ortalama boştur. Ortalamayı ve bütün denemeleri yönetici ile quizin sınıfına giren öğretmen görür; öğrenci kendi denemesini, veli bağlı çocuğunun denemesini görür, sınıf ortalaması ve başka öğrencinin sonucu açılmaz. Ön büro görmez.
- **Gerekçe:** Saklanan ortalama her yeni denemede ve soru düzeltmesinde bayatlar; başka öğrencinin sonucu kişisel veridir.
- **Kaynak:** KVKK md. 12; `DOM-YTK-022`, `DOM-YTK-025`.
- **Kurum türü:** ikisi
- **Kodda:** var — `lib/quiz.ts` (`quizStatistics`); okuma kapsamı `platform/scope.ts` (`quizzes`, `quizAttempts`).

## Deneme ve optik

### DOM-AKD-060 · Deneme ve kurum içi ölçme resmî not değildir

- **Kural:** Deneme sınavı (LGS/YKS formatı), kazanım testi, hazırbulunuşluk ve quiz sonuçları dönem puanına, karneye ve sınıf geçmeye girmez. Bunlar net, kazanım analizi ve hedef ilerlemesi üretir. Öğretmen bir kurum içi ölçmeyi resmî performans çalışması olarak kullanmak isterse puanı `DOM-AKD-004` türünde, açıkça seçerek ve tek kayıt olarak aktarır. Otomatik aktarım yoktur. Öğrencinin bir quizi tekrar çözmesi alıştırmadır ve yeni not oluşturmaz. Notlu quizde ilk tamamlanan deneme sayılır (beceri görevleri için `DOM-BEC`). Platform quizinde deneme tektir (`DOM-AKD-077`); tekrar çözme eski kayıtlarda görülür.
- **Gerekçe:** Resmî puan türleri ve sayıları mevzuatla sınırlıdır. Her quiz denemesinin not olması ortalamayı şişirir ve tekrar çözerek not yükseltmeye izin verir.
- **Kaynak:** OİKY md. 22, 27; OKY md. 50/8, 51. Tek sayılan deneme işletme kuralıdır.
- **Kurum türü:** `school` (dil okulu için `DOM-BEC`)
- **Kodda:** kısmen — deneme sonuçları ayrı koleksiyonda tutulur ve nota karışmaz (`packages/school-core/src/lib/school-workflows.js:510-519`). Çelişen kısım: her quiz denemesi yeni not kaydı ekler (`apps/web/src/views/Learning.vue:411-432`; örnek veri `packages/school-core/src/data/seed.js:376-388`).

### DOM-AKD-061 · Net hesabı

- **Kural:** Ders neti `doğru − yanlış / yanlış_katsayısı` ile bulunur ve iki ondalığa yuvarlanır. Katsayı yoksa net doğru sayısıdır. Katsayı denemenin formatından gelir ve format için profil parametresidir. Kurum denemeyi bir formata bağlar; formatı olmayan denemede katsayı elle girilir ve gerekçesi saklanır. Bir dersin doğru, yanlış ve boş toplamı o dersin soru sayısına eşittir.
- **Gerekçe:** Katsayı sınav kılavuzlarıyla yıldan yıla değişebilir; yanlış katsayı bütün hedef ilerlemesini bozar.
- **Kaynak:** İşletme kuralı. LGS ve YKS'nin güncel yanlış/doğru katsayıları ilgili yılın MEB ve ÖSYM kılavuzlarından **doğrulanmalı**.
- **Kurum türü:** `school`
- **Kodda:** var — `packages/school-core/src/lib/school-workflows.js:338-344` (`examNet`). Katsayı deneme kaydında sabit girilmiştir (`packages/school-core/src/data/school-workflows.js:47`). Soru toplamı yalnız 1–200 aralığında denetlenir, ders soru sayısıyla eşitliği denetlenmez (`school-workflows.js:507`).

### DOM-AKD-062 · Optik okuma ve cevap anahtarı

- **Kural:** Cevap anahtarındaki her soru bir derse ve kazanıma bağlıdır. Kitapçıkların ders/kazanım soru sayıları ve iptal soruları eşittir. Anahtarı yalnız yönetici düzenler; her içerik değişikliği anahtar revizyonunu artırır. Okuyucu çıktısı (CSV/DAT/TXT) önce saf önizlemeyle doğrulanır: yinelenen öğrenci, tanımsız kitapçık, düzey uyumsuzluğu ve kapsam dışı öğrenci satır numarasıyla reddedilir. Onayda güncel anahtarla yeniden hesaplanır. Anahtar revizyonu veya sonuçta elle değişiklik, eski optik analizin kullanılmasını engeller.
- **Gerekçe:** Yanlış anahtar veya eski analiz bütün sınıfın netini ve kazanım raporunu bozar.
- **Kaynak:** İşletme kuralı; resmî yazılılarda cevap anahtarının önceden hazırlanması OİKY md. 22/1-a, OKY md. 45/1-e.
- **Kurum türü:** `school`
- **Kodda:** var — `packages/school-core/src/lib/assessment-automation.js:110-171` (anahtar), `176-211` (profil ve revizyon), `270-347` (önizleme), `351-368` (güncel analiz). Elle değişiklik analiz bağını koparır (`packages/school-core/src/lib/school-workflows.js:510-519`).

### DOM-AKD-063 · Deneme sonucu giriş kapsamı

- **Kural:** Deneme sonucunu yönetici her ders için, öğretmen yalnız kendi branşı ve kendi sınıflarındaki öğrenciler için girer. Öğrencinin sınıf düzeyi denemenin düzeyiyle aynı olmalıdır; ders denemenin kapsamında olmalıdır. Öğrenci ve veli yalnız kendi sonuçlarını görür. Sınıf ortalaması gibi karşılaştırmalı göstergeler başka öğrencinin kimliğini açık etmez. Öğrenci ve veli kendi (bağlı çocuğunun) optik analizinde soru başına doğru cevabı görür: deneme sonrası öğrenciye kendi kitapçığının doğru cevaplarını göstermek olağan sonuç bildirimidir (bilinçli karar). Cevap anahtarının kendisi (profilin `keyCsv`/`keys` alanları, bütün kitapçık ve sorular) ve başka öğrencinin analizi kapalıdır. Profil satırı (başlık, okuyucu yerleşimi, revizyon) öğrenci ve veliye yalnız görebildiği, düzeyi kendi düzeyi olan denemeler için açılır; başka düzeyin denemesine ait profil liste, arama ve sayımda da görünmez.
- **Gerekçe:** Deneme sonucu kişisel veridir; branş dışı giriş ölçme güvenliğini bozar.
- **Kaynak:** İşletme kuralı; KVKK md. 12.
- **Kurum türü:** `school`
- **Kodda:** kısmen — düzey ve kapsam denetimi var (`packages/school-core/src/lib/school-workflows.js:501-504`). Öğretmen kimliği sabit `'t1'` (`505`).

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-AKD-001 | Mevzuat profili yok; not, devamsızlık ve finans sayıları kodda sabit ya da hiç yok.                                                             |
| DOM-AKD-003 | Ortalamalar tam sayıya yuvarlanır (`packages/school-core/src/lib/format.js:46-47`); lisede 4 ondalık gerekir.                                   |
| DOM-AKD-004 | Not kaydında tür, dönem ve sıra yok; serbest başlıklı örnek notlar (`packages/school-core/src/data/seed.js:219-226`).                           |
| DOM-AKD-010 | Dönem puanı formülü yok; düz ortalama gösterilir (`apps/web/src/stores/demo.js:197`).                                                           |
| DOM-AKD-023 | Haftalık ders saatine göre ağırlıklı ortalama ve YBP yok (`apps/web/src/stores/demo.js:197`).                                                   |
| DOM-AKD-030 | Yoklama gün bazında tek durum; ders saati yok (`packages/school-core/src/lib/domain.js:50-74`).                                                 |
| DOM-AKD-031 | Yarım gün ve "5 geç = yarım gün" yok; devamsızlık yalnız `absent` sayar (`apps/web/src/stores/demo.js:198-199`).                                |
| DOM-AKD-032 | Özür belgesi ve süresi yok; veli izin bildirimi geçmiş tarihi engeller ve yoklamaya bağlanmaz (`apps/web/src/views/Communication.vue:322-323`). |
| DOM-AKD-035 | Düzeltme geçmişi gün bazındaki kayıttadır; ders saati bazında sürüm yok (`DOM-AKD-030`).                                                        |
| DOM-AKD-040 | Sınıf geçme kararı yok; dönem geçişi kararı denetlemez (`packages/school-core/src/lib/school-workflows.js:846-927`).                            |
| DOM-AKD-054 | Not yayım adımı yok; çevrimdışı demo öğretmeni sabit `t1` (`sessionActor`).                                                                     |
| DOM-AKD-060 | Her quiz denemesi yeni not kaydı ekler (`apps/web/src/views/Learning.vue:411-432`).                                                             |
| DOM-AKD-061 | Ders soru toplamı soru sayısıyla eşitlenmez, yalnız 1–200 denetlenir (`packages/school-core/src/lib/school-workflows.js:507`).                  |
