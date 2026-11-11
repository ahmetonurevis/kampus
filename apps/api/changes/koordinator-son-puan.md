---
etki: minor
---

Zümre başkanı ve akademik koordinatör ek görevi; uyuşmazlıkta son puan (OG-006, F4b3b2b).

- Yeni tablo `coordinator_duties` eklendi (migration `0023_create_coordinator_duties`): öğretmen üyeliğine ek görev (`subject_head` `school`'da ders kimliğiyle, `academic_coordinator` `language_school`'da CEFR seviyesiyle; DOM-YTK-027). Rol modeli değişmedi. Etkin görev üyelik × tür × kapsam başına tekildir.
- Yeni uçlar eklendi: `GET /api/v1/coordinator-duties`, `GET /api/v1/coordinator-duties/:dutyId` (yönetici kurumun, öğretmen kendi görevleri), `POST /api/v1/coordinator-duties` (yalnız yönetici; Idempotency-Key zorunlu; 201 + `Location`; 422 `duty_requires_teacher`, `duty_outside_branch`, `teacher_record_required`, `invalid_cefr_level`; 409 `coordinator_duty_exists`), `DELETE /api/v1/coordinator-duties/:dutyId` (yalnız yönetici; `If-Match` zorunlu; arşiv). Denetime yalnız alan adları yazılır.
- Yeni uç `POST /api/v1/task-submissions/:submissionId/final-scores` eklendi: uyuşmazlıkta (DOM-BEC-024) son puanı yalnız atanan içeriğin dersinin/seviyesinin koordinatörü verir; puanlayıcılardan biri 409 `rater_not_independent`, koordinatör olmayan 403 `coordinator_required`, kapsam dışı 404, yönetici 403. Son puan sonucu kesinleştirir; geri bildirim DOM-BEC-045 ile açılır.
- Son puan yazılırken koordinatör kapsamı kurum kilidinden sonra işlem içinde yeniden okunur: görevin eşzamanlı kaldırılmasından sonra kaldırılmış göreve dayanan son puan yazılmaz (404 ya da 403 `coordinator_required`).
- Koordinatör atamayı görmese de alanındaki uyuşmazlıklı teslimi `GET /task-submissions/:submissionId` ile okur; teslim listesine erişimi yoktur. Puan görünürlüğü core `scoresVisibleToRater` ile gerçek görev denetimine bağlandı (önceden `coordinator: false`).
- Teslim ayrıntısına `versions[].grading.raterScores` (kişinin görebildiği puanlar rolleriyle) ve `versions[].grading.canResolve` eklendi. Puanlama kuyruğuna `awaiting=resolution` süzgeci eklendi; koordinatöre alanındaki uyuşmazlıklar da listelenir.
- Atama deposu (`StoredAssignment.area`) içerik sürümünün dersini ve seviyesini taşır. OpenAPI ve `api-client` şeması yeniden üretildi.
