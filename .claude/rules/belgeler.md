---
paths:
  - 'docs/**'
  - 'README.md'
  - '**/CHANGELOG.md'
---

# Doküman kuralları

- Türkçe, kısa ve güncel. Tamamlanmış geçici plan biriktirilmez.
- Mimari karar `docs/adr/NNNN-baslik.md` (Durum, Bağlam, Kararlar, Sonuçlar, Alternatifler); kabul edilmiş ADR değiştirilmez, yenisi eskisini geçersiz kılar.
- Yeni modül: `docs/sayfalar.md` rol bazlı sayfa, README'de kısa bölüm, gerekiyorsa `docs/<modul>.md` kullanım rehberi.
- Davranış değişikliği ilgili paketin `CHANGELOG.md`'sine yazılır. README "Doğrulama" bölümündeki sayılar değişiklikten sonra güncellenir.
- `sunumlar/` altındaki sunum ve ekran görüntüleri yalnız istekle değişir.
