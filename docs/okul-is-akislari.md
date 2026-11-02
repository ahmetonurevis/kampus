# Okul iş akışları

Sekiz özellik web panelinde çalışır. Servis ve yemek bağımsız açılıp kapanır; toplam dokuz yeni modül vardır. Yönetici ayarlarından kapatılan modül menüde görünmez, ekranı ve kayıt işlemleri erişime kapanır. Veriler web tarayıcısında yerel olarak saklanır.

## Rehberlik

Yönetici risk listesindeki öğrenci özetinden **Rehberlik takip dosyası aç** işlemini kullanabilir. Yönetici/öğretmen dosyaya sorumlu öğretmen, destek planı, sonraki takip tarihi, kurum içi ve paylaşılan not girer. Görüşme/sonuç işlemi yeni bir iç not ekler ve takibi tamamlayabilir. Öğrenci/veli yalnızca destek planı ve paylaşılan notları görür. Öğretmen kendi sınıflarında, kendi sorumluluğundaki dosyaları yönetir.

## Deneme sınavları

Deneme türü LGS, YKS veya okul denemesi olarak seçilir. Sınıf düzeyi, dersler ve yanlış götürme oranı kurum tarafından belirlenir; resmî sınav puanı hesaplanmaz. Ders sonucu doğru, yanlış, boş ve eksik konuları içerir. Net hesabı `doğru − yanlış / oran`; oran sıfırsa yanlış azaltması yapılmaz. Eksik ders sonuçları gelişim karşılaştırmasında ayrıca belirtilir.

Excel'den UTF-8 CSV olarak kaydedilen dosya web panelinde seçilebilir; CSV metni de yapıştırılabilir. Başlık sırası:

```csv
examId;studentId;subjectId;correct;wrong;blank;weakTopics
exam-7-1;s1;math;12;5;3;Denklemler
```

Kimlik eşleştirme listesi aktarım formunda bulunur. En fazla 1 MB dosya ve 1.000 sonuç satırı kabul edilir. Bütün satırlar doğrulanmadan kayıt değişmez. Aynı sınav/öğrenci/ders sonucu güncellenir; dosyadaki yinelenen satır reddedilir. Öğretmen yalnızca kendi branşına ve sınıflarına sonuç girer. Sınav detayındaki **çalışma planı** işlemi eksik konuları yeni göreve taşır.

## Kayıt yenileme ve dönem geçişi

Yönetici/ön büro öğrenci, yeni yıl, bir üst sınıf, brüt bedel, burs, ek indirim ve taksitleri seçer. Burs brüt bedelden; sabit indirim burs sonrası bedelden düşülür. Para kuruş cinsinden hesaplanır ve taksitlere kayıpsız dağıtılır. Son onay yeni sözleşme ve taksitleri oluşturur. Bu anda öğrencinin güncel sınıfı değişmez.

Detaydan **Dönem geçişini uygula** seçildiğinde sınıf değişir. Aynı öğrenci/yıl için mükerrer yenileme ve dolu hedef sınıfa geçiş engellenir. 12. sınıf için mezuniyet seçilebilir; mezuniyet yeni borç oluşturmaz. Eski notlar, yoklamalar ve tahsilatlar korunur. Açık rehberlik ve çalışma görevleri yeni sınıfın öğretmenlerine devredilir. Yeni dönem sözleşmesi yalnızca kendi taksitlerini içerir. Kampüs değişiminde eski servis ataması kaldırılır, eski kampüsün kulüp üyeliği sonlandırılır; kulüp geçmişi korunur.

## Program yönetimi

Yönetici tarih/saat, sınıf, ders, öğretmen, süre ve derslik seçerek ders ekler veya düzenler. Öğretmen, sınıf, derslik ve öğretmen görüşme çakışmaları engellenir. Tarih/saat Europe/Istanbul gösterilir; kayıt UTC'dir. Aynı branş ve kampüsteki uygun yedek öğretmen tek ders için atanabilir. Yedek yoksa Eğitim Kadrosu ekranından eklenir. Kalıcı branş ataması değişmez. İptal edilen ders günlük ders programlarından çıkar; yönetim ekranında geçmişi korunur. Geçmiş ya da başlamış ders değiştirilmez, yedek atanmaz ve iptal edilmez; öğretmenin etkinliği de çakışma sayılır. İptal ve yedek görevlendirme gerekçe ister; gerekçeyi öğrenci ve veli görmez. Sınıfın o günü yoklaması alınmışsa ders iptal edilemez. API: `/api/v1/lessons` uçları (DOM-YTK-068, DOM-YTK-069).

## Çalışma planı

Öğrenci kendi planını önerir; öneri öğretmen onayı bekler. Öğretmen/yönetici görev verirse doğrudan onaylanır. Ders, konu, yönerge, hedef süre ve son tarih seçilir. Öğrenci çalışma sonucunu teslim eder; öğretmen tamamlar veya tekrar çalışılmasını ister. Veli seçili çocuğunun görevlerini ve geri bildirimlerini görür. Web tarih aralığı filtreleriyle haftalık görevler seçilebilir.

## Okul takvimi

Yönetici/ön büro kampüs veya sınıf etkinliği oluşturur; öğretmen kendi sınıfına etkinlik ekler. Başlangıç/bitiş, yer, açıklama ve gerekiyorsa veli onay son günü girilir. Veli yalnızca seçili ve kendisine bağlı çocuğu adına onay veya ret verir; süre içinde kararını güncelleyebilir. Yönetici bekleyen/onaylanan/reddedilen öğrencileri etkinlik detayından görür. İptalde önceki onaylar korunur.

## Servis ve yemek

Serviste güzergâh, araç plakası, sürücü/telefon, kapasite ve sıralı duraklar tanımlanır. Öğrenci kendi kampüsündeki güzergâha atanır; tek güncel ataması vardır. Tekrar atama günceller. Dolu servis, olmayan durak veya atamalı güzergâhı arşivleme engellenir. Veli/öğrenci kendi servis ve durağını görür.

Yemek menüsü kampüs/gün bazında tekildir. Yemekler, alerjenler ve açıklama girilir; mevcut günün menüsü düzenlenebilir. Veli/öğrenci kendi kampüsünün menüsünü görür.

## Kulüpler ve sosyal gelişim

Kulüp sorumlusu, kampüs, kapasite, toplantı bilgisi ve açıklama belirlenir. Öğrenci/veli kayıt olabilir; yönetici veya kulüp sorumlusu öğretmen öğrenci ekler. Aynı üyelik çoğalmaz, kampüs ve kapasite kontrol edilir. Öğretmen kulüp yoklaması alır; aynı gün tekrar kayıt mevcut yoklamayı günceller. Aktif üyeler için proje/başarı ve kazanımlar kaydedilir. Üyelik sonlandırma veya kulüp arşivleme geçmiş yoklama ve başarıları silmez.

## Kalıcılık ve kontrol

Yeni işlemler doğrulanıp kaydedildikten sonra başarı bildirimi gösterilir. Eski snapshot sürümü 3 korunur; eski modül tercihlerine yeni modüller eklenir. Kritik işlemler kullanıcı, işlem, kayıt ve eski/yeni değerlerle yerel işlem geçmişine yazılır.

Kontrol komutları: `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`.
