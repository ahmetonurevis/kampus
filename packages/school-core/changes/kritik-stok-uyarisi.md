---
etki: minor
---

- Kritik stok uyarısı ve satın alma talebi önerisi eklendi (ON-230; DOM-FIN-079): `lib/finance-stock-alerts.ts` kurum toplamı kritik seviyeye eşit ya da altındaki etkin kartları aciliyet sırasıyla ve depo kırılımıyla listeler (`criticalStockRows`, K-200), öneri miktarını stoku kritik seviyenin iki katına tamamlayacak biçimde hesaplar (`suggestedReorderQuantity`, K-201) ve seçilen 1–50 kritik kalemden taslak satın alma talebi kalemleri ile gerekçesini üretir (`stockPurchaseDraft`, K-202, K-203).
