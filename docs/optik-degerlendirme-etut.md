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
