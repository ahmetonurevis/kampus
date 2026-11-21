// Bağış makbuzu (DOM-FIN-097; ON-258): veri makbuz ucunun yanıtından gelir, burada yeniden
// hesaplanmaz. Bağışçı bilgisi ve vergi indirimi ibaresi bağış kaydı anında kopyalanmıştır (K-297,
// K-299); iptal edilen makbuz "İptal edildi" ibaresiyle basılır. Belge düzeni doğrulanmalıdır (M-34).
import type { DonationReceipt } from '@kampus/react-shared/use-finance-donations.ts'
import {
  ANONYMOUS_DONOR_LABEL,
  DONATION_KIND_LABELS,
  DONATION_METHOD_LABELS,
  DONOR_KIND_LABELS,
  donationReceiptLabel,
} from '@kampus/school-core/lib/finance-donations.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const DONATION_RECEIPT_TITLE = 'Bağış makbuzu'

const AT = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const donationReceiptFilename = (receipt: { receiptYear: number; receiptNumber: number }) =>
  `bagis-makbuzu-${donationReceiptLabel(receipt)}.pdf`

/** Makbuzdaki bağışçı satırı: ad ve tür; anonimde sabit etiket. */
export const receiptDonor = (receipt: Pick<DonationReceipt, 'donorName' | 'donorKind'>) =>
  receipt.donorName === null
    ? ANONYMOUS_DONOR_LABEL
    : `${receipt.donorName}${receipt.donorKind === null ? '' : ` (${DONOR_KIND_LABELS[receipt.donorKind]})`}`

export function donationReceiptDocument(
  measurer: TextMeasurer,
  receipt: DonationReceipt,
  options: TemplateOptions,
): PdfDocument {
  const number = donationReceiptLabel(receipt)
  const cancelled = receipt.cancelledAt !== null
  const doc = new DocumentLayout(measurer, {
    label: 'BAĞIŞ MAKBUZU',
    badge: cancelled ? 'İPTAL EDİLDİ' : 'MAKBUZ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: number,
    footerNote:
      receipt.taxNotice === null
        ? 'Bu makbuz kurum içi bağış belgesidir; fatura veya vergi indirimi belgesi yerine geçmez.'
        : 'Bu makbuz kurumun bağış belgesidir; fatura yerine geçmez.',
  })
  doc.heading(
    DONATION_RECEIPT_TITLE,
    cancelled
      ? `İptal edildi · ${dateLabel(receipt.cancelledAt ?? '', AT)}`
      : receipt.campaign.name,
  )
  if (receipt.kind === 'cash')
    doc.highlight('BAĞIŞ TUTARI', money(receipt.amountCents ?? 0), 'TRY / Türk lirası')
  else
    doc.highlight(
      'AYNİ BAĞIŞ',
      receipt.declaredValueCents === null
        ? 'Değer beyan edilmedi'
        : money(receipt.declaredValueCents),
      receipt.declaredValueCents === null ? '' : 'Bağışçının beyan ettiği değer',
    )
  doc.fields([
    ['Makbuz no', number],
    ['Düzenlenme', dateLabel(receipt.createdAt, AT)],
    ['Bağışçı', receiptDonor(receipt)],
    ...(receipt.identityNumber === null
      ? []
      : [
          [
            receipt.donorKind === 'organization' ? 'Vergi / kimlik no' : 'T.C. kimlik no',
            receipt.identityNumber,
          ] as [string, string],
        ]),
    ['Bağış günü', dayText(receipt.donatedOn)],
    ['Bağış türü', DONATION_KIND_LABELS[receipt.kind]],
    ...(receipt.method === null
      ? []
      : [['Ödeme yolu', DONATION_METHOD_LABELS[receipt.method]] as [string, string]]),
    ...(receipt.bankAccountLabel === null
      ? []
      : [['Banka hesabı', receipt.bankAccountLabel] as [string, string]]),
    ...(receipt.reference === null
      ? []
      : [['Dekont / slip no', receipt.reference] as [string, string]]),
    ...(receipt.description === null
      ? []
      : [['Ayni bağış', receipt.description] as [string, string]]),
    ['Kampanya', receipt.campaign.name],
    ['Durum', cancelled ? 'İptal edildi' : 'Geçerli'],
  ])
  doc.paragraph(`Kampanyanın amacı: ${receipt.campaign.purpose}`, 9, COLORS.muted)
  if (cancelled && receipt.cancelReason !== null)
    doc.paragraph(`İptal gerekçesi: ${receipt.cancelReason}`, 9, COLORS.muted)
  if (receipt.taxNotice !== null) doc.paragraph(receipt.taxNotice, 9)
  return doc.finish()
}
