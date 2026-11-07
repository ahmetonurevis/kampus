---
etki: minor
---

Yeni bildirim türü `appeal_decided` (OG-021, IST-065; DOM-BEC-025, DOM-ILT-023). API tarafı `apps/api/changes/itiraz-karari-bildirimi.md`'dedir.

- `platform/notification-types.ts` içine `appeal_decided` eklendi: konu `grade`, hizmet bildirimi, `learning` modülü, 18 yaş altında öğrenci ve veli, yetişkinde öğrenci; konu kaydı teslim (`task_submission`), veri yalnız `submissionId`. `feedback_released` yeniden kullanılmadı: itiraz reddi yeni geri bildirim açmaz.
