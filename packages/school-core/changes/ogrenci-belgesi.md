---
etki: minor
---

- Öğrenci belgesi eklendi (ON-049; DOM-KAY-027): yönetici ve ön büro Kayıt İşlemleri'nden aktif kayda "Öğrenci belgesi" (dil okulu ve kursta "Kursiyer belgesi") PDF'i üretir. Core `lib/enrollment-certificate.ts` izin listeli içeriği kurar; kimlik, sağlık, ücret ve disiplin bilgisi belgeye girmez, ayrılan ve mezun 422 `enrollment_certificate_inactive`, borç belgeyi engellemez. Uç `GET /api/v1/students/:studentId/enrollment-certificate` (modül `crm`); her düzenleme `enrollment_certificate.issue` olarak denetime yazılır. Belge bilgilendirme amaçlıdır, resmî belge yerine geçmez.
