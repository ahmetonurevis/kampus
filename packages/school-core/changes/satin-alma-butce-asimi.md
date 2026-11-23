---
etki: minor
---

- Satın alma talebinde bütçe aşımı denetimi eklendi (ON-245; DOM-FIN-071, K-145…K-148): `lib/finance-purchase-requests.ts` kalanı plan eksi taahhüt (gönderilmiş ve onaylanmış talepler) olarak hesaplar, `PurchaseBudgetInfo` `committedCents` ve `overrunCents` taşır; `confirmPurchaseBudget` kalanı aşan ya da bütçe satırı olmayan talepte açık onay yoksa 409 `budget_exceeded_warning` / `budget_line_missing_warning` verir. `submitPurchaseRequestSchema` ve `approvePurchaseRequestSchema` isteğe bağlı `confirmOverBudget` alır; `planPurchaseRequestSubmit` gövdeyi doğrular ve döndürür. Davranış değişikliği: `remainingCents` artık kararı bekleyen talepleri de düşer (K-131'in yerine K-145).
