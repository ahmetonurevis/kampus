# Okul iş akışları genişletme planı

## Kapsam

Kullanıcının onayladığı sekiz özellik yalnızca web panelinde eklenir: rehberlik, deneme sınavları, kayıt yenileme, ders programı yönetimi, kişisel çalışma planı, okul takvimi/veli onayları, servis/yemek, kulüp/sosyal gelişim. Servis ve yemek ayrı açılıp kapanabilir modüllerdir.

Kullanıcı sekiz modülün mevcut demo yapısında eklenmesini seçmiştir. Backend, gerçek kullanıcı/yetki sistemi ve web–mobil senkronizasyonu eklenmez. Yeni işlemler web tarayıcısında yerel olarak saklanır. Son kapsam kararı: mobil geliştirme ve APK teslimi bu çalışmadan çıkarılmıştır.

## Fazlar ve etkilenen yerler

1. `packages/school-core`: modül kataloğu, eski kayıtlarla uyumlu başlangıç verisi, Zod doğrulaması ve rol/öğrenci kapsamı. Finansal yenileme, sınav aktarımı, kontenjan ve program çakışmaları başarısızlıkta veri değiştirmez.
2. `apps/web`: ortak navigasyon ve router, modül ayarları; mevcut tema ve tablo/form bileşenleriyle yeni iş akışları. Belge ve finans bağlantıları korunur.
3. `tests`: finansal toplam/mükerrer yenileme, sınav puanı ve atomik aktarım, program çakışması, rol kapsamı, veli onayı ve kapasite testleri. Tarayıcıda rol geçişleri, kalıcılık, dar ekran ve modül kapatma kontrol edilir.
4. Dokümantasyon ve teslim: sayfa rehberi, proje anayasaları, ortak paket sürümü/changelog; lint, format, birim/uçtan uca testler, web derlemesi. Yayın ayrı bir işlem olarak değerlendirilir.

## Kabul ölçütleri

- Her özellik ilgili rollerde kullanılabilir; kapalı modül işlem ve doğrudan ekran erişimini kapatır.
- Öğretmen kendi sınıflarını, öğrenci kendisini, veli seçtiği çocuğunu görür. Rehberlik iç notları veli/öğrenciye açılmaz.
- Geçmiş not, yoklama ve ödeme kayıtları korunur. Yenileme sözleşmesi yalnızca kendi taksitlerini içerir.
- Sınav netleri tanımlanan yanlış götürme oranıyla hesaplanır; eksik konu kayıtları çalışma planına taşınabilir.
- Program öğretmen/sınıf/derslik çakışmalarını engeller; geçici görev kalıcı branş atamasını değiştirmez.
- Etkinlik onayı, çalışma görevi, servis ataması ve kulüp yoklaması tekrar kayıtta çoğalmaz.
- Yeni bağımlılık gerektirmeden açık/koyu tema, Türkçe hata bildirimi ve mevcut yerel kayıtlar korunur.
