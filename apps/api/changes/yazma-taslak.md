---
etki: minor
---

Yazma görevi taslak döngüsü (IST-047, OG-081): taslaktan teslim ucu `POST /api/v1/task-assignments/:assignmentId/draft/submit` eklendi (`If-Match` taslak revizyonu ve `Idempotency-Key` zorunlu; taslaktan zaten teslim edilmiş revizyonun ikinci teslimi 409 `draft_already_submitted`; teslim edilen revizyon sürümde `draft_revision` olarak saklanır, metinle teslim taslağı tüketmez, boş taslak 422 `draft_empty`; taslak kalır). Taslak otomatik kaydı sıradaki sürümün penceresini kullanır: yeniden teslim istendiyse atamanın son tarihi geçmiş olsa da kaydedilir (önceden 422 `submission_closed`). Teslim ayrıntısı sürüm başına yeniden teslim turunu (`versions[].resubmissionRequest`: `dueAt`, `requestedAt`) döner; her sürümün `late` bayrağı ve puanlama kuyruğunun süresi kendi turunun son tarihiyle hesaplanır (önceden sonraki istek eski sürümü geç gösterebiliyordu; DOM-BEC-040, 044).
