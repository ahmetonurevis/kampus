---
etki: minor
---

Web öğretmen quiz ekranı quiz uçlarına bağlandı (OG-047; IST-095, DOM-AKD-075…079).

- Öğretmen Quiz Oluştur sayfası `/quizzes` ucundan sunucu sayfalı okur; başlık araması, sınıf, ders ve durum süzgeci var. Quiz hazırla (soru bankasından seçim), düzenle (yalnız değişen alan gönderilir), onaylı arşiv ve sonuç paneli aynı sağ panelde; sürüm çakışmasında girdi korunur. Çözülmeye başlanmış quizin soru alanı ve arşivi gerekçesiyle kapalıdır.
- `/quizzes` liste ucuna isteğe bağlı `q` başlık araması eklendi (Türkçe harf ve aksan duyarsız, 2–100 karakter, okuma kapsamından sonra uygulanır; kapsam dışı quiz sızmaz).
- react-shared'e quiz kancaları (`use-quizzes.ts`), Türkçe hata metinleri ve komut tanımları eklendi.
- Bilinen sınırlar: öğrenci quiz çözme ekranı ve veli sonuç görünümü bu sürümde eski demo/koleksiyon okumasıyla kalır (sonraki adım); `/quizzes` listesinde sıralama yok; yönetici menüsünde quiz sayfası yok.
