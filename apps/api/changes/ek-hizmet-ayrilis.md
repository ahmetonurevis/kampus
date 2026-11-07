---
etki: minor
---

`POST /api/v1/students/:studentId/withdrawal-quote`, `…/withdraw` ve ayrılış okumaları `breakdown.services` döner (ON-298; K-17): açık ek hizmet aboneliklerinin hizmeti, dönemi, birim tutarı, ayrılış gününe kadar kullanılan ve ödenen tutarı, kapanış günü. İade ve borç tutarı değişmez. Migration yok.
