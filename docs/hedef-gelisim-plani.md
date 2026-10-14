# Hedef ve gelişim planı

Modül anahtarı `goals`, sayfa yolu `hedef-plani`. Yönetici, öğretmen, öğrenci ve veli menüsünde **Okul iş akışları** altında görünür. Yönetici ayarlarından kapatılırsa menü ve doğrudan sayfa erişimi kapanır; kayıtlar silinmez.

## Hedef

- **Kapsam:** tek bir ders (ör. Matematik) veya genel net (üç dersin toplamı gibi, sınavın tüm derslerini içeren denemeler).
- **Hedef net:** en fazla iki ondalık basamak; mevcut netin üzerinde olmalıdır. Mevcut net yoksa başlangıç 0 sayılır.
- **Son tarih:** geçmiş olamaz. Aynı öğrenci ve kapsam için yalnızca bir açık hedef bulunur.

## Akış

1. **Öğrenci** hedefi belirler → durum `Onay bekliyor`.
2. **Yönetici veya branş öğretmeni** hedefi onaylar (`Aktif`) ya da gerekçe yazarak reddeder (`Reddedildi`). Yönetici/öğretmen kendi açtığı hedef doğrudan `Aktif` olur. Öğretmen yalnızca kendi dersinin ve genel net hedeflerini görür; ders hedefini yalnızca kendi branşında açar.
3. **Gelişim adımları** elle eklenir veya **Zayıf konulardan adım öner** ile üretilir. Öneri, deneme sonuçlarındaki eksik konulardan en fazla dört haftalık adımdır; mevcut konular tekrarlanmaz, son tarih hedef tarihini aşmaz. Bir hedefte en fazla 30 adım bulunur.
4. **Öğrenci** adımı yalnızca hedef `Aktif` iken tamamlar; tamamlanan adım tekrar tamamlanamaz.
5. **Veli** seçili çocuğun hedefini görür ve yorum ekler; başka işlem yapamaz.
6. Hedef kapatılabilir (`Kapatıldı`). Kapatılan veya reddedilen hedefe adım eklenmez; ilerleme ve yorumlar korunur.

## İlerleme hesabı

İlerleme saklanmaz, her görüntülemede deneme sonuçlarından hesaplanır:

`ilerleme % = (güncel net − başlangıç net) / (hedef net − başlangıç net)`, 0–100 arasında sınırlanır. Güncel net `≥` hedef net ise liste durumu **Ulaşıldı** görünür.

- Ders hedefinde o dersin net değeri kullanılır.
- Genel hedefte yalnızca tüm ders sonuçları girilmiş denemeler sayılır; eksik denemeler karşılaştırmaya katılmaz.
- Net: `doğru − yanlış / oran` (bkz. deneme sınavları).

## Kayıt ve denetim

Her işlem `audit` kaydına eski/yeni değerle yazılır. Veri `studentGoals` koleksiyonundadır; eski yerel kayıtlar ve modül tercihleri korunur (snapshot sürümü değişmedi). Mobil uygulamada bu modül bulunmaz.
