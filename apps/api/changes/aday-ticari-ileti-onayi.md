---
etki: minor
---

Aday ticari ileti onayı ucu eklendi: `POST /api/v1/prospects/:prospectId/marketing-consent` (ON-008; DOM-KAY-004). Yönetici ve ön büro kanal bazlı (`sms`, `email`, `call`) onay verir ya da geri alır; `If-Match` zorunludur, denetim kaydına iletişim ya da onay metni yazılmaz.
