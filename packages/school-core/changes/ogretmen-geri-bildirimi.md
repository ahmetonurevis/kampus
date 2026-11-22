---
etki: minor
---

- Öğrenci ve veli geri bildirimi kuralı eklendi (`lib/finance-teacher-feedback.ts`, DOM-FIN-159): dönemlik öğretmen geri bildirim anketinin taslak, düzeltme, yayım, kaldırma ve erken kapatma şemaları ve planları; sorular ölçek (1–5) ve açık uçlu; hedef kitle öğrenci, veli ya da ikisi ve sınıf süzgeci; anonimlik eşiği en az 5, kurum artırabilir, azaltamaz (K-532).
- `teacherFeedbackTeachersFor`, `planTeacherFeedbackResponse`: yanıtlayan yalnız kendi (velide çocuğunun) sınıfının sınıf öğretmenini ve derse giren öğretmenlerini, her öğretmeni bir kez değerlendirir (K-533).
- `teacherFeedbackTeacherResult`, `teacherFeedbackResults`, `teacherFeedbackTrend`: sonuç öğretmen başına kapanıştan sonra ve eşik geçilince döner; açık uçlu yorumlar eşik altında hiç dönmez; eşik altındaki sınıflar "diğer sınıflar" grubunda birleşir; dönemler arası eğilim genel ortalamadır (K-532).
- Personel anketi (`lib/finance-staff-surveys.ts`): `normalizeStaffSurveyAnswers` kod öneki alır, `shuffled` dışa açıldı; personel anketinin davranışı değişmedi.
