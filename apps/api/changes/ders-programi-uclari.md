---
etki: minor
---

Ders programı uçları eklendi (OG-039; IST-094, DOM-YTK-068, DOM-YTK-069). Migration yok.

- Yeni uçlar (`routes/lessons.ts`, modül `planning`): `GET /api/v1/lessons` (süzgeç `dateFrom`, `dateTo`, `classId`, `teacherId`, `room`, `cancelled`), `GET /api/v1/lessons/:lessonId`, `POST /api/v1/lessons` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/lessons/:lessonId`, `POST …/:lessonId/substitute`, `POST …/:lessonId/cancel`. Yazma yalnız yönetici; var olan derse yazma `If-Match` ister.
- Hata kodları: 409 `version_conflict`, `teacher_lesson_conflict`, `class_lesson_conflict`, `room_conflict`, `teacher_appointment_conflict`, `teacher_event_conflict`, `tutor_schedule_conflict`, `lesson_already_cancelled`; 422 `lesson_in_past`, `lesson_cancelled`, `lesson_teacher_mismatch`, `record_inactive`, `teacher_unchanged`, `lesson_attendance_taken`.
- İptal ve yedek görevlendirme gerekçesi `audit_log.reason`'a yazılır; `cancelReason` ve `substitutions` günlüklerde gizlenir.
- OpenAPI ve api-client şeması yeniden üretildi.
