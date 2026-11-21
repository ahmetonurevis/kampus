---
etki: minor
---

`POST /api/v1/prospects/:prospectId/enroll` veli–öğrenci bağını aynı işlemde `student_guardians`'a yazar (ON-010; DOM-ILT-070, DOM-ILT-074): veli velayet sahibi (`full`) ve ödeyici olarak, hesapsız bağlanır; yetişkin kursiyerde bağ yazılmaz. Bağ `guardian.link` denetim kaydıyla alan adlarıyla yazılır, yanıt değişmedi.
