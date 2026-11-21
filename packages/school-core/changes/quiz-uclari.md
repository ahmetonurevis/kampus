---
etki: minor
---

Quiz hazırlama, düzenleme, arşiv, çözme ve sunucu puanlaması kuralları eklendi (OG-046; IST-095, DOM-AKD-075…079).

- Yeni `lib/quiz.ts`: `createQuiz`, `updateQuiz`, `archiveQuiz`, `startQuiz` (`StartQuizOutcome { attempt, created, questions }`), `submitQuiz` ve gövde şemaları (web/mobil formu için de). Sorular kurumun soru bankasından, quizin dersi ve sınıfın düzeyinden seçilir (422 `quiz_question_unavailable`, `quiz_question_mismatch`); süre 5–120 dakika, son tarih isteğe bağlı saat dilimli an (UTC saklanır).
- Öğrenci başına tek deneme: başlatma süreyi işletir (`expiresAt`, son tarih daha erkense son tarih), yeniden başlatma aynı denemeyi döndürür; ikinci gönderim 409 `quiz_already_submitted`, yeni deneme 409 `quiz_already_attempted`, süre ve 60 sn ağ payı geçince 422 `quiz_time_expired`, son tarihten sonra 422 `quiz_closed`. Denemesi olan quizin soruları değişmez ve quiz arşivlenmez (409 `quiz_has_attempts`).
- Puan yalnız cevaplardan hesaplanır (`quizAttemptResult`); cevap anahtarı ve açıklama öğrenci/veli görünümüne girmez (`quizQuestionsView`, `quizAttemptView`, `canSeeQuizQuestions`). Ortalama saklanmaz (`quizStatistics`).
- Komut ve yetki tablosuna `quiz.create`, `quiz.update`, `quiz.archive` (yönetici, öğretmen), `quiz.start`, `quiz.submit` (öğrenci) eklendi; quizi gören başka öğretmen 403 `quiz_not_owner`, görmeyen 404 `quiz_not_found`.
- `State` tipine quiz (`dueDate`, `createdBy`, `updatedAt`) ve deneme (`status`, `startedAt`, `expiresAt`, `submittedAt`, `startedBy`, `updatedAt`) alanları eklendi; alanı olmayan eski deneme tamamlanmış sayılır.
- `recordGrade` quiz aktarımında süresi işleyen denemeyi saymaz (`quiz_not_attempted`).
- Deneme okuma kapsamı daraltıldı: öğretmenlerden yalnız quizin öğretmeni ve öğrencinin sınıf rehber öğretmeni okur (`quizAttemptReader`; DOM-AKD-079). Ödev teslimiyle ortak yapı taşı `modules/scope-builders.ts` `ownWorkOrHomeroom`; kapsam kaynağına isteğe bağlı `quizzes` (quiz → öğretmen) ve `Scope.quizIds` eklendi.
- Öğrenci ve veli kendi cevaplarını ve konu yüzdelerini son tarih geçince ya da quiz kapanınca görür (`quizReviewOpen`, `withheldAttemptFields`; DOM-AKD-078). `quizAttemptView` artık rolü alır; `answers` ve `result.topicScores` isteğe bağlıdır. `isQuizStaff`, `QUIZ_STAFF_ROLES` ve kayıt tipleri `QuizRecord`, `QuizAttemptRecord`, `QuizAttemptReading` dışa açıldı.
