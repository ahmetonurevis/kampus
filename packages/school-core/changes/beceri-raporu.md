---
etki: minor
---

- Beceri ve CEFR raporu eklendi (OG-100; IST-118, DOM-BEC-037): `GET /api/v1/reports/skills?groupBy=class|level` dil okulunda dil grubu ya da kur seviyesi başına etkin kursiyer sayısını, okuma/dinleme/yazma/konuşma ortalamasını (kursiyer eşit ağırlıklı, bir ondalık, kanıtsız beceri `null`), kanıt sayısını ve güncel genel seviye dağılımını verir. Kural `cefr/skill-report.ts` `skillReport`'tadır. Rapor yönetici ve öğretmene açıktır (öğretmen yalnız okuyabildiği grupları görür), okulda 404, `learning` kapalıysa 403; kişi adı ya da puanı içermez.
