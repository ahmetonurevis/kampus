# Optik değerlendirme ve otomatik etüt planı

## Kapsam

Yalnızca web, mevcut çevrimdışı demo ve yerel kalıcılık. Optik okuyucunun ürettiği cevap verisi değerlendirilir. Cevap anahtarı kitapçık, soru numarası, ders ve kazanım içerir. DAT/TXT dosyalarında kullanıcı alan konumlarını tanımlar; cevap sütunlu CSV de desteklenir. Kullanıcının genel biçim tercihiyle okul numarası eşlemeli CSV varsayılanı ve konumları ayarlanabilen DAT/TXT desteği uygulanır.

## Adımlar ve etkilenen yerler

1. `packages/school-core`: optik profil, cevap/sonuç ve etüt kayıtları; Zod şemaları, dosya ayrıştırma, atomik değerlendirme, kazanım başarı oranları ve çakışmasız etüt planlama. Mevcut snapshot sürümü ve kayıtlar korunur.
2. `apps/web`: optik değerlendirme ve etüt sayfaları; erişilebilir profil formu, dosya seçimi, önizleme/son onay, etüt planı önizleme ve yoklama. Yönetici ayarlarında bağımsız modül anahtarları; sınav sonuçlarından ilgili akışlara bağlantı.
3. `tests`: dosya/kimlik/kitapçık doğrulaması, iptal soru, boş ve çoklu işaret, mükerrer aktarım, rol kapsamı, kazanım gruplaması, öğretmen/öğrenci/derslik/randevu çakışması, kapasite, kayıt atomikliği ve kalıcılık. Tarayıcıda dosyadan etüde tam akış, dar ekran/koyu tema ve kapalı modüller.
4. Dokümantasyon ve teslim: kullanım, örnek dosyalar, paket sürümü/changelog; lint, format, birim/uçtan uca test ve web derlemesi.

## Kabul ölçütleri

- Bilinmeyen, pasif veya rol kapsamı dışındaki öğrenci otomatik eşleştirilmez; öğrenci kimliği ya da okul numarasıyla tekil eşleşme gerekir.
- Satır hatası, yinelenen kayıt, bilinmeyen kitapçık veya cevap uzunluğu hatası tüm aktarımı engeller; önizleme kayıt değiştirmez.
- İptal sorular net ve kazanım oranından çıkarılır. Boş cevaplar ve çoklu işaretler ayrı gösterilir. Ders sonuçları mevcut deneme ekranında, soru/kazanım ayrıntıları öğrenci/veli kapsamında görünür.
- Cevap anahtarı değişirse eski değerlendirmeler geçerliymiş gibi kullanılmaz; yeniden değerlendirme gerekir.
- Başarı eşiğinin altında kalan kazanımlar aynı kampüs/sınıf düzeyi/ders/kazanım için gruplanır; uygun branş öğretmeni ve okulun tanımladığı saat/derslikler kullanılır.
- Planlayıcı kayıtlı ders, randevu, etkinlik, diğer etüt, öğrenci ve öğretmen çakışmalarını engeller. Yerleşmeyen gruplar nedenleriyle gösterilir; sessizce atlanmaz.
- Aynı sınav/kazanım/öğrenci için aktif etüt tekrar oluşturulmaz. Son onayda güncel verilerle yeniden doğrulama yapılır.
- İptal ve yoklama geçmişi korunur. Öğretmen kendi görevlerini, öğrenci kendisini, veli seçili çocuğunu görür.
