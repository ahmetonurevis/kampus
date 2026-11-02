---
etki: minor
---

Ders videosu izleme ilerlemesi (OG-252; IST-041; `docs/domain/kaynak-platformu.md` DOM-KYN-005). API tarafı `apps/api/changes/video-ilerleme.md`'dedir.

- Yeni `lib/video-progress.ts` eklendi: `recordVideoProgress` (öğrenci kendi ilerlemesini ve yalnız kendi düzeyindeki videoyu yazar; yüzde konum ve süreden hesaplanır, 0–100'e sıkıştırılır ve geri gitmez; son konum ve süre ayrı saklanır), `recordVideoProgressSchema` ve `videoProgressPercent`.
- `videoProgress` kaydı isteğe bağlı `positionSeconds` ve `durationSeconds` alanlarını taşır; örnek veri ve eski kayıtlar taşımaz (oynatıcı yüzdeden türetir).
- `video.progress` komutu eklendi (modül `learning`, rol `ogrenci`; veli ve personel yazmaz).
