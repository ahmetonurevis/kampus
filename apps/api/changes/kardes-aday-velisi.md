---
etki: minor
---

`GET /api/v1/prospects/:prospectId/guardian-matches` kardeş adayın (`siblingOfId`) kesin kayıtta bağlandığı veliyi telefon farklı olsa da önerir (ON-103; DOM-KAY-013, DOM-KAY-031). Yanıt satırına `match` (`sibling` ya da `phone`) eklendi; kardeş önerisi başta gelir, telefon ve e-posta dönmez. Seçilen veliyle kesin kayıt yeni veli açmaz, bağı aynı işlemde yazar.
