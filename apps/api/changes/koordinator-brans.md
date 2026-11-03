---
etki: patch
---

`PATCH /api/v1/teachers/:teacherId`: öğretmenin branşı değişirken öğretmen kaydına bağlı üyeliğin etkin zümre başkanlığı görevi yeni branşın dışında kalıyorsa kayıt 422 `coordinator_duty_outside_branch` ile reddedilir (OG-059; DOM-YTK-027); görevler aynı transaction'da, kurum kilidinden sonra okunur ve kayıt değişmez. Denetim yalnız güncellemede çalışır; yeni kayıtta görev olamaz. Görev önce `DELETE /api/v1/coordinator-duties/:dutyId` ile kaldırılır. OpenAPI açıklaması ve `api-client` şeması yeniden üretildi.
