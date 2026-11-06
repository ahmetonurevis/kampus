---
etki: minor
---

- Yeni yılın toplu yenileme kuralları eklendi (IST-105, ON-086; `lib/renewal-bulk.ts`): yeni yıl listesinin satırı (`renewalCandidateLines`), toplu önizleme (`previewRenewalBulk`) ve toplu gövde şemaları. Satır kararı tek öğrenci kuralından gelir; borç onayı toplu gövdede yoktur, borçlu öğrenci atlanır (DOM-KAY-025). Tavan hesabı `renewalTuitionLimit` olarak paylaşıldı; plan davranışı değişmedi.
