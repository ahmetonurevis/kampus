---
etki: minor
---

- Tedarikçi faturası üçlü eşleştirmesi eklendi (ON-277; DOM-FIN-095): `lib/finance-invoice-matching.ts` fatura kalemi şeması (sipariş kalemine bağlı ya da siparişte olmayan kalem, miktar ve KDV hariç birim fiyat; sipariş kalemi faturada bir kez), kalem girişi denetimi (`checkSupplierInvoiceLines`: siparişin kalemi, kalem toplamı fatura netinden en çok 1 TL sapar), sipariş, mal kabul ve fatura eşleştirmesi (`matchOrderInvoices`: önceki etkin faturalarla birlikte kabul edileni aşan miktar farkı, kalem etkisi 1 TL'yi aşan fiyat farkı, siparişte olmayan kalem; en ağır durum faturanın durumu), sipariş özeti (`orderMatchSummary`), fark onayı (`planInvoiceMatchApproval`), ödeme kontrolü (`assertInvoicePayable`) ve eşleşmeyen faturalar CSV'si (`invoiceMatchCsv`).
- `supplierInvoiceSchema` `lines` alanını alır: siparişe bağlı faturada zorunlu, siparişsiz faturada yasaktır. `planSupplierInvoice` kalemleri döndürür; `InvoiceOrderLink` siparişin kalem kimliklerini (`itemIds`) ister.
- `planSupplierPayment` bağlamı `invoiceMatch` ister: sapması onaylanmamış faturanın ödemesi 409 `supplier_payment_invoice_mismatch_warning` verir.
