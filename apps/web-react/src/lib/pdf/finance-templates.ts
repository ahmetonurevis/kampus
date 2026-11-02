// TODO(pdf-receipt): şablonlar `templates/` altına taşındı; Oğuzhan'ın alanındaki iki içe aktarım
// (`hooks/use-document-pdf.ts`, `tests/pdf-finans-belgeleri.test.ts`) geçince bu dosya silinir.
export {
  paymentReceiptDocument,
  receiptNumberLabel,
  type ReceiptPayment,
} from './templates/payment-receipt.ts'
export { refundStatementDocument, type RefundWithdrawal } from './templates/refund-statement.ts'
