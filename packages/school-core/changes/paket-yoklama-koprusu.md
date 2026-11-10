---
etki: minor
---

- Yoklama köprüsünün finans ucu eklendi (ON-084; IST-078, DOM-DIL-051, DOM-DIL-054; K-250): `lib/finance-package-lessons.ts` (`pickLessonPackageSale`, `planLessonPackageHours`, `lessonPackageUsageSchema`). Grup dersi önce aynı kurun kur satışından, yoksa saat paketinden; özel ders yalnız özel ders paketinden düşer; süresi en erken dolan satış önce kullanılır. Yoklamadan gelen ders saati önce elle girilen kullanılan saat farkından (K-21) düşer, toplam iki kez sayılmaz.
