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
- Yeni modül: `docs/sayfalar.md` rol bazlı sayfa (kayıt ve finans satırı burada, diğer React sayfaları `docs/sayfalar/platform.md`'de), README'de kısa bölüm, gerekiyorsa `docs/<modul>.md` kullanım rehberi.
- Davranış değişikliği ilgili paketin `changes/<konu>.md` parçasına yazılır (geçmiş zaman edilgen, kırıcı satır "**Kırıcı:**" ile); teslimde `CHANGELOG.md`'ye `## x.y.z` başlığıyla derlenir (git-ve-surum §5). README "Doğrulama" sayıları yalnız teslimde güncellenir; ara dönemde CI yeşili esastır.
- Hukuki süre veya yükümlülük yazan madde kaynağını belirtir; kaynağı doğrulanmamış ya da hukukçu onayı bekleyen madde tek etiketle, **doğrulanmalı**, işaretlenir.
- `sunumlar/` altındaki sunum ve ekran görüntüleri yalnız istekle değişir.
