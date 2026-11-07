// Dekont numarasının tek gösterim biçimi (DOM-FIN-050). Web, mobil, PDF, dışa aktarım, e-Özel ve
// ekstre aynı metni yazar; e-Özel işaretinin parmak izi de bu metni içerdiğinden biçim değişirse
// işaretlenmiş satırlar "düzeltilmeli" görünür.

export type ReceiptNumbered = {
  readonly receiptYear: number
  readonly receiptNumber: number
}

/** Kurum ve yıl içinde ardışık numara "<yıl>-<sıra>" olarak yazılır; dolgu ve binlik ayracı yoktur. */
export function receiptNumberLabel(payment: ReceiptNumbered): string {
  return `${String(payment.receiptYear)}-${String(payment.receiptNumber)}`
}
