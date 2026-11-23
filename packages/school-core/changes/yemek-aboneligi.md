---
etki: minor
---

- Yemek aboneliği ve gün iptali kuralı eklendi (`lib/finance-meal-subscriptions.ts`, DOM-FIN-164): öğrenci, kurumun açık öğünü (menü öğün anahtarları), başlangıç–bitiş (en çok 366 gün), hafta günleri ve diyet türü (normal, vejetaryen, glütensiz, laktozsuz, diğer + kısa açıklama) şemaları (`mealSubscriptionCreateSchema`, `mealSubscriptionUpdateSchema`, `mealSubscriptionIssues`); aynı öğünde tarihleri değen abonelik çakışmadır, başlamış abonelikte yalnız bitiş günü değişir ve bugünden önceye çekilmez (`planMealSubscriptionCreate`, `planMealSubscriptionUpdate`, `assertMealSubscriptionArchivable`; K-547).
- Gün iptali `planMealCancellations` ve geri alma `assertMealCancellationRestorable`: kesim kurum ayarıdır (`mealSubscriptionSettingsSchema`, varsayılan bir gün önce 15:00 İstanbul; `mealCancellationDeadline`), kesimden sonra veli reddedilir, okulun iptali geç iptaldir; tatil, geçmiş ve yemek günü olmayan gün iptal edilmez (K-548). Abonelik takvimi `mealSubscriptionCalendar`.
- Günlük mutfak sayısı `mealDailyCount` (öğün × diyet, iptaller düşülmüş, sınıf kırılımı, tatilde sıfır) ve aylık gün özeti `mealMonthSummary` (abone, tatil, iptal, geç iptal, yemek ve iade/mahsup günü; tutar yok; K-549).
