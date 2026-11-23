---
etki: patch
---

- Öğretmenin branşı değişince koordinatör görevinin kapsamı tutarlı kalır (OG-059; DOM-YTK-027, IST-005): `saveTeacher` ve `updateTeacher` yeni `coordinatorDuties` seçeneğini alır; yeni branşın dışında kalan etkin zümre başkanlığı görevi varsa kayıt 422 `coordinator_duty_outside_branch` ile reddedilir (yol `subjectId`, Türkçe ileti). Görev sessizce kesilmez ya da arşivlenmez; yönetici önce görevi kaldırır. Yeni saf kural `assertDutiesFitBranch` (`lib/coordinator-duties.ts`). Akademik koordinatörlük CEFR seviyesine bağlı olduğundan etkilenmez. Seçenek verilmezse (demo kalıcılığı) davranış değişmez.
