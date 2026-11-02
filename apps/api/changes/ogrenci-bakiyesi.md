---
etki: minor
---

Öğrenci bakiyesi ucu eklendi: `GET /api/v1/finance/students/:studentId/balance` (ON-013; DOM-FIN-052). Yönetici, ön büro, velayetli ve kısıtsız bağlı veli ve öğrencinin kendisi okur; kapsam dışı öğrenci 404, öğretmen 403, modül kapalı 403.
