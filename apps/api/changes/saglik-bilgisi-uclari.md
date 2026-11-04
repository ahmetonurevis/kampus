---
etki: minor
---

Öğrencinin sağlık ve acil bilgisi uçları eklendi (OG-090; IST-020, DOM-ILT-035, DOM-YTK-052): `GET /api/v1/students/:studentId/health-profile` ve kısmi `PATCH` (gönderilmeyen alan değişmez, `version` ile iyimser kilit, 409 `version_conflict`). Yanıt okuyana göredir: tam görünüm (`level: full`) yönetici, rehber öğretmen, 18 yaş altı öğrencinin velayetli kısıtsız velisi ve 18+ öğrencinin kendisindedir; derse giren öğretmen yalnız acil görünümü (`level: emergency`) alır. Uçlar modülsüzdür (çekirdek kayıt). Her başarılı okuma ve yazma aynı transaction'da denetim kaydına yazılır (`health_profile.read`, `health_profile.read_emergency`, `health_profile.update`; yalnız alan adları).
