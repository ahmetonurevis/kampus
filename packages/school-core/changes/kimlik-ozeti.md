---
etki: patch
---

- API: `GET /api/v1/students/:studentId/identity` her başarılı okumayı aynı transaction'da denetim kaydına `student_identity.read` olarak yazar; denetime numara ve doğum tarihi değil alan adları gider (ON-063, DOM-YTK-052).
- Web: sözleşme panelinde yönetici ve ön büro için "Kimlik bilgisi" bölümü eklendi; kimlik "Kimliği göster" ile maskeli okunur, "Gizle" ile bellekten atılır.
