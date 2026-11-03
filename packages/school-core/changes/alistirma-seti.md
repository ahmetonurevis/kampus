---
etki: minor
---

- Ünite alıştırma setinin çekirdek kuralları eklendi (OG-085, IST-056; DOM-BEC-047, DOM-BEC-048): quiz ve alıştırma seti içeriği `unit` (numara 1–40, isteğe bağlı başlık; `contentUnitSchema`) taşır. `skills/practice.ts` alıştırmada madde kontrolünü (`planItemCheck`; madde başına 2 hak, doğru ya da hak bitince kilit, yalnız kilitli maddenin anahtarı, mükerrer kontrol hak tüketmez, değerlendirmede 422 `instant_feedback_unavailable`, kilitli maddede 422 `item_check_locked`), geri bildirimi (`itemFeedback`), kilitli cevapların korunmasını (`withLockedAnswers`) ve alıştırma not defterinin ünite, beceri ve kazanım kırılımını (`practiceGradebook`, `practiceShownAttempt`: son tamamlanan deneme) hesaplar. `ScoringItem` maddenin becerisini ve kazanımlarını (`skill`, `outcomes`; soru etiketsizse setinki) taşır.
