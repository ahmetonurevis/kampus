---
etki: minor
---

- Gezi ve etkinlik ücreti kuralı eklendi (`lib/finance-paid-activities.ts`, DOM-FIN-098, K-300…K-303): etkinlik tanımı ve düzeltmesi, katılımda öğrenciye sözleşmesiz `activity` taksiti, kontenjan ve mükerrer katılım denetimi, son iptal gününe kadar tam iade, sonra oran ya da kişi başı masraf kesintisi, kurum iptalinde tam iade, iade ödemesi ayrılış iadesinin kurallarıyla.
- Taksit türleri tarife kalemlerinden ayrıldı: `INVOICE_FEE_KINDS` ve `INVOICE_FEE_KIND_LABELS` (`lib/fee-tariffs.ts`) tarife türlerine `activity`'yi ekler; `FEE_ITEM_KINDS` değişmedi. Muhasebe aktarımı kalem etiketini yeni listeden okur.
- Tahsilat iptali iptal edilen etkinlik katılımının taksitine alınmış tahsilatı reddeder (`reversePayment`, `activityInvoiceIds`, `payment_activity_cancelled`).
