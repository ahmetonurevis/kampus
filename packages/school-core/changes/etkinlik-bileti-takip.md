---
etki: minor
---

- Etkinlik bileti takipleri eklendi (ON-345, DOM-FIN-103; K-378…K-380): girişi geri alma (`undoEventTicketCheckInSchema`, `planEventTicketCheckInUndo`, `eventTicketCheckInUndoBlocker`; yönetici ya da okutan görevli, etkinlik günü bitene kadar, gerekçeyle), aile başına üst sınır (`EVENT_LIMIT_SCOPES`, `limitScope`; `planEventTicketAllocation` `family` kümesiyle kardeşlerin biletlerini birlikte sayar), kısmi iade (`eventRefundQuote`: 7+ gün tam, 1–6 gün %50, etkinlik günü ve sonrası yok; `cancelEventTicketSchema.refundCents` kuraldan farklı tutarı yalnız yönetici notla yazar) ve iadenin ödendiği işareti (`refundEventTicketSchema`, `planEventTicketRefund`, `eventTicketRefundStatus`).
- Davranış değişikliği: `planEventTicketCancel` artık etkinlik başlangıcı, an ve rol alır; `refunded` yerine `refundCents` döner, ödenmiş biletin iptali iadeyi ödenmiş saymaz. `EventTicketFacts` bilet bedeli, okutan ve iade alanlarını taşır; `eventTicketSummary` net tahsilatı (iade düşülür, kesinti kalır) ve bekleyen iadeyi verir; CSV'nin "İade" sütunu "İade tutarı", "İade" ve "İade zamanı" sütunlarına ayrıldı.
