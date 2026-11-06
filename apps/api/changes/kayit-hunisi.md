---
etki: minor
---

Kayıt hunisi ucu eklendi: `GET /api/v1/prospects/funnel` (ON-051; DOM-KAY-040, IST-117). Aday → görüşme → deneme dersi (yalnız dil okulu) → kesin kayıt adımlarını birikimli sayar, adım ve genel dönüşüm oranlarını, güncel aşama sayılarını, kaynak ve danışman (adayı açan personel, adı yalnız kurum üyesi için) kırılımını döner. Kohort adayın açılış günüdür (`dateFrom`/`dateTo`, Europe/Istanbul). Yalnız yönetici ve ön büro, modül `crm`; yanıt aday adı, iletişim bilgisi ve aday kimliği taşımaz.
