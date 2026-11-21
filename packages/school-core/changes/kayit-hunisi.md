---
etki: minor
---

- Kayıt hunisi hesabı eklendi (ON-051; DOM-KAY-040, IST-117): `enrollmentFunnel` aday → görüşme → deneme dersi (yalnız dil okulu) → kesin kayıt adımlarını birikimli sayar, her adımın önceki adıma oranını ve genel dönüşüm oranını (yüzde, bir ondalık) verir; güncel aşama sayıları ile kaynak ve danışman (adayı açan personel) kırılımı da döner. `funnelSteps`, `funnelStepLabel`, `funnelRate` ve okuyabilen roller `ENROLLMENT_FUNNEL_ROLES` (`yonetici`, `onburo`) eklendi.
