---
etki: minor
---

- Yemekhane alerji uyarısı kuralı eklendi (`lib/finance-meal-allergy-checks.ts`, DOM-FIN-162): sağlık profilindeki serbest metin alerji adı 14 alerjene eşlenir (`matchAllergy`, `normalizeAllergyText`; belirsiz ad korumacı, besin dışı alerji listeye girmez, eşlenemeyen ad `unmatched`/`partial` olarak elle kontrole düşer; K-541).
- `mealAllergyWarnings`, `hasMealAllergyWarning`: öğünün kalemleriyle kesişen alerjenler kalem başına ve en ağır şiddetiyle; teşhis, ilaç ve eşlenen alerjinin adı dönmez (K-542).
- `assertMealAllergyServiceDate` (bugün ile 7 gün sonrası), `mealAllergyAcknowledgementSchema`, `planMealAllergyAcknowledgement`: "uyarı görüldü, alternatif verildi" işareti yalnız bugünün öğününde, uyarılı öğrenci için, öğrenci × gün × öğün başına bir kez (K-543). Rol `MEAL_ALLERGY_ROLES` (yönetici, ön büro).
- `HEALTH_ACCESS_ACTION_LABELS`'a `finance.meal_allergy.roster_read` ("Yemekhane alerji uyarısı") eklendi.
