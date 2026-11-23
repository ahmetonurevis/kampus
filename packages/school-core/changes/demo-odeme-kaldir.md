---
etki: minor
---

- Çevrimdışı demonun tek seferlik ödeme yolu `lib/payments-demo.ts`'e ayrıldı (ON-037): `payInvoice` ve eski demo yöntemleri (`LEGACY_DEMO_PAYMENT_METHODS`: `Demo Sanal POS`, `Kredi kartı (demo)`) yalnız buradadır. `lib/payments.ts`'teki `payInvoice` aynı işlevin `@deprecated` köprüsüdür; mobil ve eski test tüketicileri geçince kalkar (OG-074, OG-072). Davranış değişmedi. API, React, `api-client` ve `react-shared` kaynaklarının bu yola ad, dosya ya da demo yöntem değeriyle bağlanmadığını `tests/payments-demo.test.ts` denetler (DOM-FIN-030, DOM-FIN-031).
