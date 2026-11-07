---
etki: minor
---

Ayrılış dökümü açık ek hizmet aboneliklerini gösterir (ON-298; K-17, DOM-FIN-040): `WithdrawalContext.studentServices`, `WithdrawalBreakdown.services` (`WithdrawalServiceLine`: hizmet, dönem, birim tutar, ayrılış gününe kadar kullanılan, ödenen, kapanış günü). Satırlar iade ve borç hesabına girmez; taksit listesi olmayan eski sözleşme abonelik taksitini saymaz. Ekran ve belge için `withdrawalServiceRows`, `withdrawalServiceTitle`, `WITHDRAWAL_SERVICE_NOTE` (`lib/finance-student-services.ts`).
