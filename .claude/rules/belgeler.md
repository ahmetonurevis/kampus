---
paths:
  - 'docs/**'
  - 'README.md'
  - '**/CHANGELOG.md'
---

# Doküman kuralları

- Türkçe, kısa ve güncel. Tamamlanmış geçici plan biriktirilmez.
- Mimari karar `docs/adr/NNNN-baslik.md` (Durum, Bağlam, Kararlar, Sonuçlar, Alternatifler); kabul edilmiş ADR değiştirilmez, yenisi eskisini geçersiz kılar.
- Mühendislik kuralları `docs/muhendislik/` altındadır; `.claude/rules/*.md` onların kısa özetidir. Kural değişince ilgili belge ve kural dosyası aynı committe güncellenir; kural dosyası ~30 satırı geçmez, ayrıntı belgeye atıf yapar.
- Domain iş kuralları `docs/domain/` altındadır; mühendislik belgelerine iş kuralı yazılmaz.
- Yeni modül: `docs/sayfalar.md` rol bazlı sayfa, README'de kısa bölüm, gerekiyorsa `docs/<modul>.md` kullanım rehberi.
- Davranış değişikliği ilgili paketin `CHANGELOG.md`'sine yazılır (en yeni üstte, `## x.y.z`, geçmiş zaman edilgen, kırıcı satır "**Kırıcı:**" ile). README "Doğrulama" bölümündeki sayılar değişiklikten sonra güncellenir.
- Hukuki süre veya yükümlülük yazan madde kaynağını belirtir ya da "hukuk onayı" ile işaretlenir.
- `sunumlar/` altındaki sunum ve ekran görüntüleri yalnız istekle değişir.
