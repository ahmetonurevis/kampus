---
etki: minor
---

Web quiz ekranları quiz uçlarına bağlandı (OG-047; IST-095, DOM-AKD-075…079).

- Öğretmen Quiz Oluştur sayfası `/quizzes` ucundan sunucu sayfalı okur; başlık araması, sınıf, ders ve durum süzgeci var. Quiz hazırla (soru bankasından seçim), düzenle (yalnız değişen alan gönderilir), onaylı arşiv ve sonuç paneli aynı sağ panelde; sürüm çakışmasında girdi korunur. Çözülmeye başlanmış quizin soru alanı ve arşivi gerekçesiyle kapalıdır.
- `/quizzes` liste ucuna isteğe bağlı `q` başlık araması eklendi (Türkçe harf ve aksan duyarsız, 2–100 karakter, okuma kapsamından sonra uygulanır; kapsam dışı quiz sızmaz).
- react-shared'e quiz kancaları (`use-quizzes.ts`), Türkçe hata metinleri ve komut tanımları eklendi.
- Öğrenci Quiz & Testler sayfası sınıfın quizlerini `/quizzes` ucundan okur; açık quizi onayla başlatır ve `?quiz-coz=` çözme ekranında cevaplar. Kalan süre sunucunun bitiş anından gösterilir, süre dolunca cevaplar bir kez kendiliğinden gönderilir; sayfa yenilenince açık deneme aynı bitiş anıyla sunucudan sürer, cevaplar yalnız bellekte tutulur ve kirli ekrandan çıkarken onay sorulur. Süresi geçmiş gönderim (422) ve başka yerden gönderilmiş deneme (409) ekranı bozmaz.
- Öğrenci ve veli sonucu sunucunun cevaplardan hesapladığı puandır; istemcideki `gradeQuiz` hesabı kaldırıldı. Son tarih geçene ya da quiz kapanana kadar yalnız puan ve doğru sayısı, sonra konu yüzdeleri ve kendi cevapları görünür; doğru şık ve çözüm öğrenci ve veliye gösterilmez. Veli Akademik Takip quiz sekmesi seçili çocuğun sonucunu aynı kuralla salt okur gösterir.
- Bilinen sınırlar: çözme ekranında cevaplar yalnız bellektedir, sayfa yenilenince seçimler sıfırlanır (süre sürer); `/quizzes` listesinde sıralama yok; yönetici menüsünde quiz sayfası yok; mobil quiz ekranları bu sürümde değişmedi.
