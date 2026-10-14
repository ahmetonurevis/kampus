# Değişiklikler

## 1.3.0

- Hedef & gelişim planı modülü (`goals`) eklendi: ders veya genel net hedefi, deneme sonuçlarından hesaplanan ilerleme, onay akışı, zayıf konulardan haftalık adım önerisi ve veli yorumları. Veri `studentGoals` koleksiyonundadır; snapshot sürümü ve eski kayıtlar korunur.
- `modules/full-navigation.js` eklendi: temel menü ile okul iş akışı modüllerini birleştirir; web ve mobil aynı menüyü kullanır. Web'in `modules/navigation.js` dosyası bunu yeniden dışa aktarır.
- `lib/text-decoding.js` eklendi: UTF-8 ve Windows-1254 çözücü, tüm platformlarda aynı sonucu verir.
- `saveTeacher` isteğe bağlı `now` parametresi aldı; varsayılan davranış değişmedi. Tüketiciler `workspace:1.3.0` sürümüne sabitlendi. Mobil artık iş akışı modüllerini menüsünde gösterir.

## 1.2.0

- Web için CSV ve ayarlanabilir sabit alanlı DAT/TXT optik değerlendirme eklendi. Kitapçık/soru/kazanım anahtarı, iptal/boş/çoklu cevap, tekil öğrenci eşleme ve atomik sonuç güncellemesi desteklenir.
- Eksik kazanımlara göre uygunluk saatleri, derslik kapasitesi ve ders/randevu/etkinlik rezervasyonlarını denetleyen etüt planlama; yoklama ve iptal geçmişi eklendi. Öğrenci/veli kapsamı daraltılır; program ve dashboard etütleri gösterir.
- Manuel sonuç değişikliği veya cevap anahtarı revizyonu eski optik analizi geçersiz kılar. Snapshot sürümü ve eski kayıtlar korunur. Yeni web modülleri mobil menülere eklenmez; tüketiciler `workspace:1.2.0` sürümüne sabitlendi.

## 1.1.0

- Web paneli için rehberlik, deneme sınavları, kayıt yenileme/dönem geçişi, program yönetimi, çalışma planı, okul takvimi/veli onayı, servis, yemek ve kulüp iş akışları eklendi. İşlem doğrulaması, rol kapsamı ve form tanımları paylaşılır.
- Kayıt yenileme yeni sözleşmenin taksitlerini ayırır; geçmiş sözleşmelerin toplamı korunur. Program iptalleri günlük görünümden çıkarılır.
- Snapshot sürümü 3 korunur; eski modül tercihleri bozulmadan yeni modüller varsayılan olarak açılır. Tüketiciler `workspace:1.1.0` sürümüne sabitlendi.

## 1.0.2

- Yoklama işlemi mazeretli (`excused`) durumunu destekler; geçersiz tarihleri kaydetmeden reddeder. Mobil ve web aynı durum etiketini kullanır. Kayıt şeması ve mevcut yoklamalar korunur.

## 1.0.1

Web ve Android'in Türkçe tarih/para biçimleyicileri tekrar kullanılır. Büyük listelerde satır başına Intl kurulum maliyeti kaldırıldı; İstanbul saat dilimi ve para çıktıları korunur. Kayıt biçimi değişmedi.

## 1.0.0

Web ve Android için ortak özel okul verisi, kayıt/finans/yoklama/puanlama kuralları, modül menüleri ve belge verisi.
