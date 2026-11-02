---
etki: minor
---

Quiz hazırlama, çözme ve sunucu puanlaması uçları (OG-046; IST-095, DOM-AKD-075…079).

- Yeni uçlar (`routes/quizzes.ts`, etiket `quizzes`, modül `learning`): `GET /api/v1/quizzes`, `GET /api/v1/quizzes/:quizId`, `POST /api/v1/quizzes` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/quizzes/:quizId`, `DELETE /api/v1/quizzes/:quizId` (arşiv), `POST /api/v1/quizzes/:quizId/attempt` (başlat; `Idempotency-Key` zorunlu; yeni 201, süren 200), `POST /api/v1/quizzes/:quizId/attempt/submit` (`Idempotency-Key` zorunlu; 200). Quiz düzenleme ve arşivi `If-Match` ister.
- Süre sunucuda işler: deneme başlatılınca `expiresAt` (başlangıç + süre, en geç son tarih) yazılır; gönderim 60 sn ağ payıyla kabul edilir, sonrası 422 `quiz_time_expired`. Tek deneme: ikinci gönderim 409 `quiz_already_submitted`, sonuçlanmış denemede yeniden başlatma 409 `quiz_already_attempted`.
- Puan yalnız cevaplardan, bankadaki anahtarla hesaplanır; gövdede puan alanı 400. Sonuç ve ortalama (`statistics`) her okumada cevaplardan hesaplanır, saklanmaz.
- Yanıt şeması role özgüdür: cevap anahtarı ve çözüm açıklaması (`answerKey`) yalnız yönetici ve öğretmen ayrıntısında (`QuizStaffDetail`); öğrenci ve veli (`QuizPersonalDetail`) anahtarı, soru bazında doğru/yanlışı ve sınıf ortalamasını görmez. Doğru sayısı `correctCount` adıyla döner.
- Davranış değişikliği: süresi işleyen quiz denemesi `/collections/quizAttempts` okumasında (liste, sayım, tekil kayıt) hiçbir role dönmez; süresi dolan deneme 0 ile döner. Bu koleksiyonda yönetici listesi SQL sayfası yerine bellek yolunu kullanır.
- Hata kodları: 403 `quiz_scope_denied`, `quiz_not_owner`, `student_scope_denied`; 409 `quiz_has_attempts`, `quiz_already_attempted`, `quiz_already_submitted`; 422 `quiz_subject_required`, `quiz_teacher_unavailable`, `quiz_question_unavailable`, `quiz_question_mismatch`, `quiz_due_in_past`, `quiz_closed`, `quiz_not_started`, `quiz_time_expired`, `quiz_answer_invalid`, `record_inactive`, `student_inactive`.
- Log: yeni `redact` alanı yok (gövde loglanmaz; bankanın `answer` alanı listede). Migration yok (kayıtlar `records` koleksiyonlarında).
- OpenAPI ve api-client şeması yeniden üretildi.
