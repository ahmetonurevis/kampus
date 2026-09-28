# Kampüs mobil geliştirme kuralları

Bu dosya oluşturma şablonunun genel önerilerini proje kararlarıyla özelleştirir. Kapsam ve iş planı kök CLAUDE.md ile bu dizindeki CLAUDE.md içindedir.

- React Native / Expo SDK 57, React Navigation native stack. Mobil kategori menüsü bütün modüllere eriştirir.
- Expo API değişikliklerinde SDK 57 resmi dokümantasyonu ve kurulu paketin tipleri kontrol edilir. Native bağımlılıklar `expo install` ile uyumlu sürümde eklenir.
- Yerel Android release derlemesi kullanılır; Expo bulut hesabı veya EAS yayını gerekmez. Üretilen native dizinler yeniden üretilebilir olmalıdır; değişiklikler config plugin üzerinden yapılır.
- Safir/turuncu, beyaz zemin, açık/koyu tema; renk geçişi ve dekoratif renkli kenar çizgisi yoktur.
- Ortak iş kuralları `packages/school-core` içindedir. Beş rol aynı veriyi kullanır. Kalıcılık başarısızsa işlem başarılı gösterilmez.
- Lint, format, ortak kritik iş kuralları, web derlemesi ve Android derleme/kurulum testleri tamamlanmadan APK teslim edilmez.
