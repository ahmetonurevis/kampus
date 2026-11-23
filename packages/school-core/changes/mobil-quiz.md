---
etki: patch
---

- Öğrenci quiz durum modeli (deneme durumu, başlatma kararı, şık harfi, inceleme satırı) web'den `react-shared/quizzes.ts`'e taşındı; web ve mobil aynı modeli kullanır, davranış değişmedi (OG-061, IST-124).
- Mobil API modunda öğrenci Quiz & Testler ekranı eklendi: sınıf quizleri (açık, tamamlanan, süresi geçen), onaylı başlatma, soru gezinmeli çözme, sunucu saatiyle sayaç, ağ hatasında kaybolmayan cevaplarla yeniden gönderme ve sunucunun hesapladığı sonuç (OG-061, IST-124).
