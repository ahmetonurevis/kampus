# Optik değerlendirme ve otomatik etüt

Bu iki özellik yalnızca web panelindedir. İşlemler tarayıcıda çalışır ve yerel demo kaydına yazılır. Optik okuyucunun çıkardığı CSV veya sabit alanlı DAT/TXT cevap dosyaları kullanılır; fotoğraf/PDF üzerinden optik işaret tanıma yapılmaz.

## İlk kullanım

1. Yönetici → Deneme Sınavları ekranında sınavı oluşturun; düzeyi, dersleri ve yanlış cezasını seçin.
2. Yönetici → Optik Değerlendirme ekranında sınav için profil oluşturun. Başlangıçtaki 7. sınıf profili, 12 soruluk A/B örnek anahtarıdır; gerçek sınavın anahtarıyla değiştirin.
3. Her soruya kitapçık, sıra numarası, ders kodu, kazanım ve doğru cevap tanımlayın. Profili kontrol edip onaylayın. Ekrandan anahtar şablonunu ve profile uygun örnek cevap dosyasını indirebilirsiniz.
4. Dosya seçin veya içeriği yapıştırın. Sonuçları önizleyin; öğrenciyi, kitapçığı, doğru/yanlış/boş ve netleri kontrol edin. Son onay sonuçları kaydeder.
5. Otomatik etüt bağlantısından başarı eşiğini, tarih aralığını, süreyi ve grup büyüklüğünü seçin. Planı önizleyin; yerleşen ve yerleşmeyen grupları inceleyip onaylayın.

## Cevap dosyası

CSV başlığı aşağıdaki sırada olmalıdır. Noktalı virgül ve virgül ayırıcıları, tırnaklı hücreler ve UTF-8 BOM desteklenir.

```csv
student;booklet;answers
2026001;A;BBBDABCDABCD
```

`student`, profilde seçilen öğrenci kimliği veya okul numarasıdır. Okul numarası varsayılandır. Eşleşme tekil olmalıdır; bilinmeyen/pasif öğrenci, yanlış sınıf düzeyi, kapsam dışı öğrenci veya yinelenen satır tüm aktarımı engeller. Öğretmen yalnızca kendi sınıflarındaki öğrencilerin kendi branş sonuçlarını kaydeder.

DAT/TXT için başlangıç konumları **1'den** sayılır. Varsayılan örnek: öğrenci numarası 1–7, kitapçık 8, cevaplar 9–20. Alan konumu/uzunluğu ve atlanacak başlık satırı sayısı profilde değiştirilir; alanlar çakışamaz. Cevap uzunluğu anahtardaki soru sayısına eşit olmalıdır. Son boş satırlar atlanır; cevap alanındaki boşluklar korunur.

Dosya sınırı 1 MB, en fazla 1.000 öğrenci satırıdır. Kodlama UTF-8 veya Windows-1254 seçilebilir. İzin verilen uzantılar `.csv`, `.dat`, `.txt` olur.

Cevaplar A–E; boş cevap boşluk, `-`, `.`, `_`; çoklu işaret `*` olur. Küçük harf cevaplar büyütülür. Çoklu işaret yanlış sayısına dahil edilir ve ayrıca gösterilir. İptal soru doğru anahtarında `-` ile belirtilir; net ve kazanım hesabına dahil edilmez. Net, sınavda seçilen yanlış cezasıyla hesaplanır ve negatif olabilir.

## Cevap anahtarı ve kazanımlar

```csv
booklet;question;subjectId;topic;answer
A;1;math;Denklemler;B
A;2;turkish;Sözcükte anlam;C
A;3;science;Hücre;A
```

Bu başlık örneğidir; sınavın tüm soruları girilir. Soru numaraları her kitapçıkta 1'den başlayıp kesintisiz gider. En fazla 8 kitapçık ve kitapçık başına 400 soru desteklenir; ders başına üst sınır 200 sorudur. `subjectId`, sınavın ders kodlarından biri olmalıdır. Her derste en az bir iptal edilmemiş soru bulunmalıdır. Kitapçıkların ders/kazanım soru sayıları ve iptal sayıları eşit olmalıdır; soru sıraları ve doğru cevaplar farklı olabilir.

Kazanım başarısı, doğru / iptal edilmemiş soru sayısıdır. Yüzde ekranda yuvarlanır; etüt eşiği gerçek oranla karşılaştırılır. Eşiğe eşit başarı etüde alınmaz. Aynı sınav/öğrenci/ders tekrar değerlendirildiğinde sonuç güncellenir, çoğalmaz. Anahtar değişince eski soru analizi etüt için kullanılmaz; dosyayı yeniden değerlendirin. Deneme ekranından manuel değiştirilmiş sonuç da eski optik analizle eşleştirilmez.

Öğrenci ve veli, Deneme Sınavları detayında kendilerine ait soru ve kazanım analizini görür. Velinin seçili çocuğu değişince kapsam değişir.

## Etüt yerleştirme ve takip

Öğrenciler kampüs, sınıf düzeyi, ders ve kazanıma göre gruplanır. Aktif branş öğretmeni, öğretmenin tanımlı uygunluk saatleri ve yeterli kapasitedeki aktif derslikler kullanılır. Uygunluklar belirli tarihlerdeki saatlerdir; tekrar eden haftalık program olarak yorumlanmaz. Uygunluk saati eklenebilir/kaldırılabilir; saati kaldırmak mevcut etüdü iptal etmez.

En fazla 31 günlük aralık seçilir. Süre 15–120 dakika, grup büyüklüğü 1–40 öğrencidir; derslik kapasitesi daha küçükse gruplar bölünür. Öğretmen, öğrenci, derslik, ders, randevu, okul etkinliği ve diğer etüt çakışmaları denetlenir. Uygun saat, öğretmen veya derslik bulunmayan öğrenciler nedenleriyle gösterilir. Kısmi plan onaylanabilir; yerleşmeyenler için uygunluk ekleyip tekrar planlayın.

Önizleme kayıt oluşturmaz. Son onay planı güncel verilere göre yeniden denetler; veri değişmişse yeni önizleme istenir. Aynı sınav/kazanım/öğrenci için planlanmış veya tamamlanmış etüt yeniden oluşturulmaz. İptal edilen etüt yeniden planlanabilir. İptal gerekçesi ve yoklama geçmişi korunur.

Etütler öğrenci/veli ders programına ve dashboard'daki yaklaşan derslere yansır. Öğretmen kendi etütlerini yönetir. Yoklama başlangıç saati geldikten sonra Geldi/Gelmedi/İzinli olarak kaydedilir ve güncellenebilir; tamamlanmış etüt iptal edilemez. Öğrenci/veli görünümünde diğer öğrencilerin adları, başarıları ve yoklamaları gösterilmez.

İleri tarihli etüt rezervasyonuyla çakışan yeni ders, etkinlik veya randevu engellenir. İlgili öğretmen/kampüs/sınıf arşivi ve öğrencinin dönem geçişi için önce ileri tarihli etüt iptal edilmelidir. Saatler UTC kaydedilir ve Türkiye saatiyle gösterilir.

Yönetici → Ayarlar ekranında Optik Değerlendirme ve Otomatik Etüt ayrı ayrı kapatılabilir. Kapalı modülün menüsü ve doğrudan bağlantısı kapanır; kayıtlar silinmez. Optik modülü kapanınca mevcut etüt takibi devam eder. Yeni değerlendirme ve etüt planlama için Deneme Sınavları modülü açık olmalıdır. Etüt modülü kapalı olsa da mevcut rezervasyonlar çakışma denetiminde korunur.

## API uçları

Aynı işlemler API'de de çalışır (`POST /api/v1/assessment/<komut>`; ayrıntı `docs/muhendislik/api-tasarimi.md`). Rol, kapsam ve kurallar web ile aynıdır, çünkü school-core `runAssessment`'ı çalıştırır.

- **Komutlar:** `profile` (yalnız yönetici), `evaluate`, `plan`, `slot`, `slot-remove`, `cancel`, `attendance`. Yazma yönetici ve öğretmendedir; öğrenci, veli ve ön büro 403 alır. `optical` kapalıysa `profile` ve `evaluate`, `tutoring` kapalıysa diğerleri 403 `module_disabled` döner; dil okulunda bu modüller 404'tür.
- **Okuyucu dosyası:** `evaluate` gövdesine dosyanın metni (`text`) ve `profileId` konur; cevap anahtarı `profile` gövdesinde `keyCsv`'dir. Alan en çok 1 MB'tır; aşarsa 413 ve hiçbir kayıt yazılmaz. Dosya hatası (bilinmeyen öğrenci/kitapçık, yanlış cevap uzunluğu, sütun sayısı…) 422'dir ve `issues[0].path` `["text","line",<satır>]` ile hatalı dosya satırını gösterir; hatada hiçbir sonuç kaydedilmez. Dosyayı çözmek ve kodlama (UTF-8/Windows-1254) istemcidedir.
- **Önizleme (yazmaz):** `POST /assessment/evaluate/preview` ve `POST /assessment/plan/preview` kaydı, sürümü ve denetim kaydını değiştirmez. Plan önizlemesi önerilen etütleri (kapasiteyle), yerleşemeyen grupları nedenleriyle (öğretmen, derslik, uygunluk, kapasite, çakışma) ve zaten karşılanan kazanımları döner.
- **Son onay:** `plan` ve `evaluate` `Idempotency-Key` ister; aynı anahtar aynı sonucu tekrarlar, çoğaltmaz. `plan` her zaman güncel planı yeniden hesaplar. Önizlemedeki `expectedPlan` gönderilirse ve plan değişmişse hiçbir şey yazılmaz: 409 `tutoring_plan_stale` ve `issues` içinde eklenen/kalkan/öğrencisi değişen etütler döner; yeni önizleme alın. `evaluate` aynı şekilde `expectedDigest` ile 409 `evaluation_stale` döner. Aynı anda iki onaydan yalnız biri etüt oluşturur; ikincisi 422 `tutoring_nothing_to_create` alır.
- **Okuma:** `GET /api/v1/collections/opticalProfiles|opticalEvaluations|tutorSessions|availability`. Etüt kaydında öğrenci ve veli yalnız kendi adını, başarısını ve yoklamasını görür; öğretmen kendi etütlerini ve uygunluklarını, kendi branşının sonuçlarını görür. Öğrenci kendi, veli bağlı çocuğunun soru analizini `opticalEvaluations`'tan okur (Deneme Sınavları detayında görünür); başka öğrencinin kaydı listede yoktur ve tek kayıt okuması 404 döner. Bu iki rol `opticalProfiles`'ı yalnız güncel analizi eşlemek için okur: cevap anahtarı alanları (`keyCsv`, `keys`) gelmez. Ön büro her iki koleksiyonu da okuyamaz (403). Modülün menü rolleri (yönetici, öğretmen) bu okumayı kapatmaz: core `scope.ts` `READ_BEYOND_MODULE_ROLES` satır kuralı olan öğrenci/veliye açar; modül kapalıysa yine 403.

## React web ekranı (geçiş durumu)

`apps/web-react` içindeki Optik Değerlendirme ve Otomatik Etüt ekranları API üzerinden çalışır; Vue demosundaki her işlem henüz yoktur:

- Optik ekran: profiller salt okunur listelenir; cevap dosyası seçilip core ile ön kontrol edilir (ilk hata satır numarasıyla gösterilir, toplu hata listesi yoktur). "Onayla ve sonuçları kaydet" düğmesi ve profil oluşturma/düzenleme henüz kilitlidir; API uçları (`evaluate`, `profile`) hazırdır, ekran bağlantısı sıradadır.
- Etüt ekranı: plan önizlemesi istemcide core ile hesaplanır; onay `POST /tutor-sessions` ile gönderilir, sunucu planı yeniden hesaplar ve fark varsa ekran yeni planı ve farkı gösterir. Yoklama ve gerekçeli iptal API'ye bağlıdır. Öğretmen uygunluk saati ekleme/kaldırma ekranda henüz yoktur (API ucu `slot`/`slot-remove` hazır); uygunluk saatleri seed/yönetici verisinden gelir.
- Plan önizlemesi için gereken koleksiyonlar tarayıcıda okunur; ekran `POST /assessment/plan/preview` ucuna bağlanınca bu okuma kalkacaktır.
- Dil okulunda iki sayfa "Modül kullanıma kapalı" der.
