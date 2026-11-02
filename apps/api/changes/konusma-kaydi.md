---
etki: minor
---

Beceri görevinde dosyalı teslim ve konuşma ses kaydı (OG-048; IST-051, IST-126; DOM-BEC-046, 050…054; ADR 0003 karar 5, 6, 9, 13).

- Migration `0031_add_submission_version_files`: `submission_versions.file_ids` (`uuid[]`, en çok 10).
- `POST /api/v1/task-assignments`: `submission.submissionKind` artık `file` ve `audio` alabilir (önceden 422 `submission_kind_unavailable`); konuşma süresi `speakingSeconds` isteğe bağlı, varsayılan 180 sn.
- `POST /api/v1/task-assignments/:assignmentId/submissions`: dosyalı (`fileIds`) ve sesli (`recordingFileId`) gövde kabul edilir. Dosya kursiyerin kendi yüklediği hazır dosyadır ve sürümle aynı işlemde sürüme bağlanır: başkasının ya da olmayan dosya 404, hazır olmayan 422 `file_not_ready`, başka kayda bağlı 409 `file_already_attached`, rıza geri çekildiği için imhaya işaretli 422 `file_unavailable`; görev türüne uymayan gövde 422 `submission_kind_mismatch`. Sesli teslim işlem anında geçerli rıza ister (403 `consent_required`); ölçülmemiş kayıt 422 `recording_not_measured`, boş `recording_empty`, sınırı aşan `recording_too_long`. Konuşma kaydının saklama sonu bağlanırken yazılır.
- `GET /api/v1/task-submissions/:submissionId`: sürümlerde `files` (tür, boyut, süre, `processing`/`ready`/`deleted`; özgün ad yok).
- `GET /api/v1/files/:fileId/url`: teslim sürümüne bağlı dosyayı teslimi okuyabilen açar; konuşma kaydını 18 yaşını doldurmuş kursiyerin velisi ve ön büro açamaz, her açılış `file.access` denetimidir.
- Dosya bağlama (`attachFile`, ödev teslimi dahil): saklama sonu geçmiş (imhaya işaretli) dosya 422 `file_unavailable` alır; rıza yoksa önce 403 `consent_required`.
- Yeni zamanlanmış iş `files.purge-expired` (her gün 04:15, Europe/Istanbul, kurum başına): saklama sonu gelen dosyanın nesnesini siler, satırı `deleted` kalır, `file.purge` denetim satırı yazılır. Nesne silinemezse satır yine `deleted` kalır, hata yalnız kimliklerle loglanır.
- OpenAPI ve api-client şeması yeniden üretildi.
