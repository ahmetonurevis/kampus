---
etki: minor
---

- Öğrenci belgesi eklendi (ON-049; DOM-KAY-027): yönetici ve ön büro Kayıt İşlemleri'nden aktif kayda "Öğrenci belgesi" (dil okulu ve kursta "Kursiyer belgesi") PDF'i üretir. Core `lib/enrollment-certificate.ts` izin listeli içeriği kurar; kimlik, sağlık, ücret ve disiplin bilgisi belgeye girmez, ayrılan ve mezun 422 `enrollment_certificate_inactive`, borç belgeyi engellemez. Uç `GET /api/v1/prospects/students/:studentId/enrollment-certificate` (modül `crm`); her düzenleme `enrollment_certificate.issue` olarak denetime yazılır. Belge bilgilendirme amaçlıdır, resmî belge yerine geçmez.
- Veli ve öğrenci belgeyi kendisi indirir (ON-304; K-32, DOM-KAY-027): veli Sözleşmeler sayfasında seçili çocuğu, öğrenci Ödemelerim sayfasında kendisi için. Uç `GET /api/v1/finance/students/:studentId/enrollment-certificate` (veli, öğrenci; modül `finance`, kapalı `crm` etkilemez). Velayetsiz, iletişim kısıtlı ve yalnız ödeyici veli ile kapsam dışı öğrenci 404; ayrılan ve mezun 422; her indirme aktör rolüyle denetime yazılır.
