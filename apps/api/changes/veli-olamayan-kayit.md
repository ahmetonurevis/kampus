---
etki: minor
---

Kesin kayıtta seçilen mevcut veli bir öğrencisinde iletişim kısıtlı ya da velayetsizse 422 `parent_not_guardian` (`issues` yolu `guardian`) döner, kayıt yazılmaz; `GET /prospects/:id/guardian-matches` böyle veliyi önermez (ON-105; DOM-ILT-070, DOM-ILT-074). Bağlar `student_guardians`'tan veli kimliğiyle okunur (`db/enrollment-bonds.ts`).
