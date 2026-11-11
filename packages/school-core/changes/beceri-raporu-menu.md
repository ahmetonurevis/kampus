---
etki: minor
---

- Dil okulu menüsüne "Beceri Raporu" sayfası eklendi (OG-100; IST-118, DOM-BEC-037): `platform/navigation.ts` `API_LANGUAGE_SCHOOL_PAGES` yol `beceri-raporu`, modül `learning` (kapalıysa sayfa gizlenir). Yönetici RAPORLAR, öğretmen AKADEMİK kategorisinde görür; ön büro, öğrenci ve veli görmez, okulda (`school`) görünmez.
- React web: grup ya da kur seviyesi başına kursiyer sayısı, beceri ortalamaları, kanıt sayısı ve seviye dağılımı; kanıtsız beceri "—" ve "kanıt yok" gösterilir.
