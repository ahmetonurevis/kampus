---
etki: major
---

- **Kırıcı:** İade ödemesi kurumun bildirilmiş banka hesabını ister (M-13, DOM-FIN-032, DOM-FIN-041): `payRefundSchema` zorunlu `bankAccountId` alanı aldı; `planRefundPayment` üçüncü parametre olarak gün metni yerine `{ today, bankAccountIds, dayClosed }` bağlamı alır. Hesap kurumun arşivlenmemiş hesabı değilse `refund_bank_account_invalid`, ödeme günü kapatılmışsa `finance_day_closed` (alan `paidDate`) verir. Geçiş: çağıran kurumun hesap kimliklerini ve ödeme gününün kapanış durumunu verir; formlar hesap seçimini gönderir.
- **Kırıcı:** Gün sonu özeti o gün ödenen ayrılış iadesini sayar (M-13, DOM-FIN-036): `FinanceDaySummary` ve `FinanceDayMethodTotal` `refundPaidCount` ve `refundPaidCents` alanlarını taşır, yalnız `Banka havalesi` satırında dolar (`REFUND_PAYMENT_METHOD`); net tahsilat − iptal − iade ödemesidir. `financeDaySummary` isteğe bağlı üçüncü parametre olarak ödenmiş iadeleri (`{ amountCents, paidDate }`) alır, `financeDayRefunds` günün iadelerini süzer. `financeDayStamp` iade adedini de içerir (`tahsilat:iptal:iade:net`); eski damga kapanışta reddedilir. Kasa beklenenine iade girmez.
