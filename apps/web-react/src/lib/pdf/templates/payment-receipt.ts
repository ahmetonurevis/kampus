// Tahsilat dekontu: veri API tahsilat kaydından gelir, hesap burada yeniden yazılmaz (DOM-FIN-050).
import { receiptNumberLabel } from '@kampus/school-core/lib/finance-receipt.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export type ReceiptPayment = {
  id: string
  studentName: string | null
  amountCents: number
  creditCents: number
  method: string
  reference: string | null
  bankAccountLabel: string | null
  paidAt: string
  receiptYear: number
  receiptNumber: number
  reversedAt: string | null
  allocations: readonly { invoiceId: string; amountCents: number }[]
}

const AT = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

// Dekont no biçimi core'dadır (DOM-FIN-050); belge dosya adı (`use-document-pdf.ts`) buradan alır.
export { receiptNumberLabel }

/** Tahsilat dekontu; iptal edilen tahsilatta "İptal edildi" ibaresiyle erişilebilir (DOM-FIN-033). */
export function paymentReceiptDocument(
  measurer: TextMeasurer,
  payment: ReceiptPayment,
  options: TemplateOptions,
): PdfDocument {
  const number = receiptNumberLabel(payment)
  const reversed = payment.reversedAt !== null
  const doc = new DocumentLayout(measurer, {
    label: 'TAHSİLAT DEKONTU',
    badge: reversed ? 'İPTAL EDİLDİ' : 'DEKONT',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: number,
    footerNote: 'Bu dekont kurum içi tahsilat belgesidir; fatura veya e-arşiv yerine geçmez.',
  })
  doc.heading(
    'Tahsilat dekontu',
    reversed
      ? `İptal edildi · ${dateLabel(payment.reversedAt ?? '', AT)}`
      : 'Eğitim hizmeti tahsilatı',
  )
  doc.highlight('TAHSİL EDİLEN TUTAR', money(payment.amountCents), 'TRY / Türk lirası')
  doc.fields([
    ['Dekont no', number],
    ['Öğrenci', payment.studentName ?? '—'],
    ['Ödeme tarihi', dateLabel(payment.paidAt, AT)],
    ['Ödeme yöntemi', payment.method],
    ['İşlem referansı', payment.reference ?? '—'],
    ['Banka hesabı', payment.bankAccountLabel ?? '—'],
    ['Durum', reversed ? 'İptal edildi' : 'Geçerli'],
  ])
  if (payment.creditCents > 0)
    doc.paragraph(
      `Bu tahsilatın ${money(payment.creditCents)} tutarındaki kısmı taksitlere dağıtılmamıştır; iade alacağıdır.`,
    )
  doc.paragraph(
    `Tahsilat ${String(payment.allocations.length)} taksite dağıtılmıştır.`,
    8,
    COLORS.muted,
  )
  return doc.finish()
}
