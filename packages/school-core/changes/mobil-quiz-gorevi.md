---
etki: minor
---

- Mobil öğrenci quiz görevi çözme eklendi (OG-061; DOM-BEC-043): süreli deneme, cevap kaydı, teslim ve sonuç ekranı; süre dolunca kayıtlı cevaplarla sunucu teslimi izlenir, kesin reddedilen gönderim sonucu yenileme döngüsüne girmez.
- Deneme modeli (`attempt-model`, `useTaskAttempts` kancaları) `@kampus/react-shared` paketine taşındı; web ve mobil aynı modeli kullanır.
- Öğrenci ve veli görev görünümünde `hasListening` alanı eklendi; mobil dinlemeli görevi bu alanla tanır.
