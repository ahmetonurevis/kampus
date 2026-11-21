---
etki: minor
---

Ödev verme, düzenleme, arşiv, teslim ve değerlendirme kuralları eklendi (OG-045; IST-095, DOM-AKD-070…074).

- Yeni `lib/homework.ts`: `assignHomework`, `updateHomework`, `archiveHomework`, `submitHomework`, `gradeSubmission` ve gövde şemaları (web/mobil formu için de). Son teslim saat dilimli ISO an olarak girilir, UTC saklanır; geçmiş son tarih 422 `homework_due_in_past`.
- Geç teslim ödev açıksa (`allowLate`, varsayılan açık) `late` işaretiyle kabul edilir, kapalıysa 422 `homework_closed`; puanlanmış teslim 409 `submission_graded`; teslim almış ödev arşivlenmez (409 `homework_has_submissions`).
- Komut ve yetki tablosuna `homework.assign`, `homework.update`, `homework.archive` (yönetici, öğretmen), `homework.submit` (öğrenci) ve `homework.grade` (öğretmen) eklendi; ödevi gören başka öğretmen 403 `homework_not_owner`, görmeyen 404 `homework_not_found`.
- Yeni bildirim türü `homework_graded` (konu `homework`, modül `learning`, öğrenci ve 18 yaş altında veli; yalnız ödev kimliği).
- Teslim okuması (`submissions`) öğretmende ödevin öğretmeni ve sınıf rehber öğretmeniyle sınırlandı (`submissionReader`, DOM-AKD-074); kapsam kaynağına isteğe bağlı `homework` (ödev → öğretmen) ve `Scope.homeworkIds` eklendi. Yeniden teslim sonucu `detach` listesini (kayıttan düşen dosyalar) taşır.
- `State` tipine ödev (`allowLate`, `createdBy`, `updatedAt`) ve teslim (`fileIds`, `late`, `submittedBy`, `gradedAt`, `gradedBy`, `updatedAt`) alanları eklendi.
