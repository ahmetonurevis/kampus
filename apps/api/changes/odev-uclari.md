---
etki: minor
---

Ödev verme, teslim ve değerlendirme uçları (OG-045; IST-095, DOM-AKD-070…074).

- Yeni uçlar (`routes/homework.ts`, etiket `homework`, modül `learning`): `GET /api/v1/homework`, `GET /api/v1/homework/:homeworkId`, `POST /api/v1/homework` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/homework/:homeworkId`, `DELETE /api/v1/homework/:homeworkId` (arşiv), `POST /api/v1/homework/:homeworkId/submissions` (`Idempotency-Key` zorunlu; ilk teslim 201, yenileme 200), `POST /api/v1/homework/:homeworkId/submissions/:submissionId/grade`. Var olan ödeve ve teslime yazma `If-Match` ister.
- Teslim dosyaları `POST /files` (amaç `submission`) ile yüklenir ve teslimle aynı işlemde `homework_submission` türüyle bağlanır; bağlı dosyayı teslimi okuyabilen (yönetici, öğrenci, veli, ödevin öğretmeni ve sınıfın rehber öğretmeni) indirir. Başkasının ya da başka kurumun dosyası 422 `file_unavailable`, hazır olmayan 422 `file_not_ready`, başka kayda bağlı 409 `file_already_attached`. Yeniden teslimde listeden düşen dosyanın bağı kalkar (`detachFile`); dosya bağlanmamış dosya temizliğine girer.
- Teslim okuması daraldı (DOM-AKD-074): öğretmen yalnız kendi ödevinin ve rehberi olduğu sınıfın teslimlerini görür; bu kural `/homework` uçlarında, dosya bağlantısında ve `/collections/submissions` okumasında geçerlidir. Okuma kapsamı öğretmenin kendi ödevlerini ayrıca yükler; ödev listesi ve teslimler kapsam ön süzgeciyle (`scopePrefilter`) yüklenir.
- Puanlama aynı transaction'da `homework_graded` bildirimini yazar (öğrenci ve 18 yaş altında veli).
- Hata kodları: 403 `homework_scope_denied`, `homework_not_owner`, `student_scope_denied`; 409 `homework_has_submissions`, `submission_graded`; 422 `homework_due_in_past`, `homework_closed`, `homework_subject_required`, `homework_teacher_unavailable`, `record_inactive`, `student_inactive`.
- Log: `feedback` pino `redact` listesine eklendi. Migration yok (kayıtlar `records` koleksiyonlarında).
- OpenAPI ve api-client şeması yeniden üretildi.
