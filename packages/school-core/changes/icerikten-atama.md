---
etki: minor
---

- Toplu atama kuralı eklendi (`skills/assignment.ts` `assignmentBatchInputSchema`, `planAssignmentBatch`; IST-034, DOM-BEC-049): aynı içerik tek işlemde en çok 20 hedef grubuna, her biri kendi son tarihiyle ayrı atama olarak verilir; bir öğe reddedilince hiçbir plan çıkmaz, hata öğenin yoluyla (`items.<sıra>`) döner, aynı kursiyer iki öğeden aynı içeriği alamaz.
- İçeriğe bağlı sonuç özeti eklendi (`skills/content-results.ts` `tallyOutcomes`; DOM-BEC-036): hedefteki kursiyer, tamamlayan ve puan ortalaması her okumada hesaplanır, saklanmaz.
- API'ye `POST /api/v1/task-assignments/batches` (`Idempotency-Key` zorunlu, tek transaction) ve `GET /api/v1/resources/:resourceId/assignment-results` (yönetici ve öğretmen; öğretmen yalnız kendi sınıflarının hedeflerini görür) uçları eklendi.
- React web içerik havuzu ayrıntısına `Ata` penceresi (hedef satırları, satır başına son teslim, hata ilgili satırda) ve "Atamalar ve sonuçlar" özeti (atama ve hedef başına tamamlayan ve ortalama; dar ekranda kart) eklendi (`ContentAssignPanel.tsx`, `ContentAssignmentResults.tsx`).
