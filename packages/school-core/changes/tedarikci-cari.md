---
etki: minor
---

- Tedarikçi carisi ve ödeme planı kuralları eklendi (ON-143; DOM-FIN-076): `lib/finance-supplier-ledger.ts` tedarikçi faturası şeması (KDV dahil ya da hariç tutar ve KDV, boşluksuz büyük harfli ve tedarikçide tekil fatura numarası, tek vade ya da toplamı faturaya eşit ödeme planı, isteğe bağlı sipariş bağı ve sipariş tutarını aşan faturanın `confirmOverOrder` açık onayı), taksite yazılan kısmi ödeme (havale, EFT, nakit, çek; nakit dışı ödeme kurum banka hesabından; taksit kalanını aşamaz; kapatılmış güne nakit ödeme ve kapalı bugünde nakit ödeme iptali yazılmaz), fatura ve ödeme iptali gerekçeyle, fatura bakiyesi ve durumu (`supplierInvoiceBalance`), iptalleri iptal gününe yazan yürüyen bakiyeli tedarikçi ekstresi (`supplierStatement`) ve havale/EFT ödemeleri için genel ödeme talimatı CSV'si (`planPaymentInstruction`, `paymentInstructionCsv`; daha önce alınmış ödeme `confirmReexport` ister).
