---
etki: minor
---

Kurum türü `course_center` (kurs) tanındı (OG-033, IST-001; ADR 0008). `GET /api/v1/me` ve oturum yanıtlarında `type` üç değerlidir; tür listesi core'dan gelir (`apps/api/src/auth.ts` yeniden dışa aktarır). Kursta deneme, optik, etüt ve hedef uçları açıktır, rehberlik ve kayıt yenileme uçları 404'tür (DOM-YTK-012). Yeni kurum açılırken modül haritası verilmezse türün varsayılanı yazılır (`ensureInstitution`, core `defaultModuleMap`; kursta servis, yemek ve kulüp kapalı). Veritabanı değişmedi: `institutions.type` `text` kolondur, migration yok.
