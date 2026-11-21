---
etki: minor
---

Alıştırma madde kontrolü ve not defteri uçları eklendi (OG-085; IST-056, DOM-BEC-047, DOM-BEC-048). `POST /api/v1/task-attempts/:attemptId/checks` (`If-Match` zorunlu) alıştırmada tek maddeyi kontrol eder: madde başına 2 hak, doğru ya da hak bitince kilit, 422 `item_check_locked` ve değerlendirmede 422 `instant_feedback_unavailable`; deneme yanıtına `feedback` alanı eklendi. `GET /api/v1/practice-gradebook` yönetici, öğretmen ve öğrencinin alıştırma sonuçlarını ünite, beceri ve kazanım kırılımıyla verir; veli 403. Veli alıştırma tesliminde (yazma ve konuşma dahil) ve deneme ayrıntısında puan, rubrik ve geri bildirimi artık görmez (DOM-BEC-041). Migration 0045 `attempt_item_checks` tablosunu ekler.
