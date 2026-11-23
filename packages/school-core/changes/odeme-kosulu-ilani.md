---
etki: minor
---

- Peşin ve süreli ödeme koşulları tarifenin parçası oldu (ON-119; DOM-FIN-002, DOM-FIN-013): `lib/payment-terms.ts`, `paymentTerms` alanı (tarife, form) ve yayım denetimi (`tariff_payment_terms_required`, `tariff_early_payment_without_upfront`). Kesin kayıt, yenileme, ek protokol ve iş akışı köprüsü taksit sayısını ilanlı koşula bağlar (`payment_term_not_in_tariff`), peşin indirimi yalnız peşin koşulunda geçer (`early_payment_requires_upfront`), koşulun fiyat farkı `payment_term` indirim kalemi olur ve `DOM-FIN-021` tavanına girer. Sözleşme koşulun kopyasını taşır (`ContractTerms.paymentTerm`, isteğe bağlı). Koşulsuz eski tarife ve sözleşmeler değişmeden çalışır.
