---
etki: minor
---

- Yemek menüsü kuralı eklendi (`lib/finance-meal-menus.ts`, DOM-FIN-157): pazartesiyle başlayan haftalık menü (kurum ya da kampüs), gün × öğün (kahvaltı, öğle, ikindi ara öğünü) × sıralı kalem şemaları; aynı hafta ve kampüste tek menü, önceki haftadan kopya (`planMealMenuCreate`, `shiftMealItems`; K-526).
- Türk Gıda Kodeksi Ek-1'in 14 alerjeni (`ALLERGENS`, `ALLERGEN_LABELS`, `ALLERGEN_HINTS`) ve tamsayı besin değeri (enerji kcal, gramlar gramın onda biri) eklendi; günlük toplam `mealDayTotals`, alerjen matrisi `mealAllergenMatrix` ile hesaplanır, saklanmaz (K-528).
- `planMealMenuUpdate`, `assertMealMenuPublishable`, `assertMealMenuUnpublishable`, `assertMealMenuArchivable`: taslak serbestçe düzenlenir; yayımlanmış menünün geçmiş günü yalnız yöneticinin gerekçeli düzeltmesiyle değişir, başlamış hafta yayımdan kaldırılmaz, yayımlanmış menü silinmez (K-527).
- Aile görünümü için `familyMenuFor`: kampüsün yayımlanmış menüsü, yoksa bütün kampüslerin menüsü.
