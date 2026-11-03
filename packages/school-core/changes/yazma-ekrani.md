---
etki: minor
---

- Yazma görevi web ekranı taslak döngüsüne bağlandı (OG-082; IST-047, DOM-BEC-040, 044, 046): öğrencinin "Teslim et"i önce bekleyen otomatik kaydı tamamlar, sonra kaydedilen taslağı revizyonuyla (`POST /api/v1/task-assignments/:id/draft/submit`, `If-Match`) teslim eder; teslim edilen metin kaydedilen revizyondur. Sözcük sayısı yazarken çekirdeğin sayacıyla (`wordCountCheck`) canlı ve görevin sınırıyla gösterilir; sınır aşımı yine yalnız uyarıdır. Zaten teslim edilmiş taslak (409 `draft_already_submitted`), boş taslak (422 `draft_empty`) ve son sürümle aynı metin metin alanının altında Türkçe mesajla gösterilir; teslimden sonra odak sürüm listesine geçer. `@kampus/react-shared` `useSubmitTaskDraft`, `submitTaskDraftCommand` ve `submitTaskDraftRequest`'i dışa açtı.
- Öğretmenin puanlama penceresi (`?puanla=`) iki ya da daha çok sürümde iki sürümü yan yana karşılaştırır: varsayılan son iki sürümdür, sütun başına sürüm seçilir, dar ekranda sütunlar alt alta dizilir. Her sürümde o sürüm için istenen yeniden teslim turunun istenme zamanı ve son tarihi (Europe/Istanbul) görünür; geç teslim rozeti korundu. Tek sürümde karşılaştırma görünmez.
