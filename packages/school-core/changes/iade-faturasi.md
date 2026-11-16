---
etki: minor
---

- İade faturası ve iptal isteği kuralları eklendi (ON-266, DOM-FIN-096; K-292…K-295): `lib/finance-refund-invoices.ts` belge türü önerisi (`suggestRefundDocumentKind`; tam iade ve iptal penceresinde iptal isteği, değilse iade faturası; pencere `REFUND_CANCEL_WINDOW_DAYS`, `cancelWindowEndsOn`), taslak (`createRefundInvoiceSchema`, `planRefundInvoice`; tutar iadeyi ve asıl faturayı aşamaz, KDV asıl faturanın oranıyla `splitVat`), durum geçişleri (`planRefundInvoiceReady`, `planRefundInvoiceComplete`, `planRefundInvoiceDiscard`), eylemler (`refundInvoiceActions`) ve CSV (`refundInvoicesCsv`).
- İade belgesi web formu eklendi: `refundInvoiceFormSchema` (tutarlar metin), `refundInvoiceFormToInput` (kuruşa çevirir, önerilen türü gövdeye yazmaz) ve `refundInvoiceFormField` (sunucu doğrulama yolunu form alanına eşler).
