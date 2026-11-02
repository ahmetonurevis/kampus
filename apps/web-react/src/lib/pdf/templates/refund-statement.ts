// İade hesap kırılımı: veri ayrılış kaydından gelir, hesap burada yeniden yazılmaz (DOM-FIN-040, -041; IST-110).
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@kampus/school-core/lib/withdrawals.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export type RefundWithdrawal = {
  id: string
  studentName: string | null
  withdrawalDate: string
  reason: WithdrawalReason
  targetSchool: string | null
  refundCents: number
  debtCents: number
  refundDueDate: string
  refundPaidDate: string | null
  maskedIban: string | null
  refundAccountHolder: string | null
  breakdown: {
    baseCents: number
    deductionBasisPoints: number
    deductionCents: number
    attendedUnits: number
    totalUnits: number
    usageCents: number
    entitledCents: number
    paidCents: number
    creditCents: number
    extras: readonly { kind: string; paidCents: number; usedCents: number }[]
  }
}

const DAY = { year: 'numeric' } as const

/** İade hesap kırılımı: karar anındaki döküm aynen yazılır (DOM-FIN-041, IST-110). */
export function refundStatementDocument(
  measurer: TextMeasurer,
  withdrawal: RefundWithdrawal,
  options: TemplateOptions,
): PdfDocument {
  const { breakdown } = withdrawal
  const doc = new DocumentLayout(measurer, {
    label: 'İADE HESAP KIRILIMI',
    badge: 'İADE',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: withdrawal.id.slice(0, 8).toUpperCase(),
    footerNote:
      'Kesinti oranı ve hesap tabanı ÖÖKY md. 56 yorumuna dayanır; hukuki görüş yerine geçmez.',
  })
  doc.heading('İade hesap kırılımı', `${withdrawal.studentName ?? '—'}`)
  doc.highlight(
    withdrawal.refundCents > 0 ? 'İADE TUTARI' : 'KALAN BORÇ',
    money(withdrawal.refundCents > 0 ? withdrawal.refundCents : withdrawal.debtCents),
    'TRY / Türk lirası',
  )
  doc.fields([
    ['Öğrenci', withdrawal.studentName ?? '—'],
    ['Ayrılış tarihi', dateLabel(withdrawal.withdrawalDate, DAY)],
    ['Ayrılış nedeni', WITHDRAWAL_REASON_LABELS[withdrawal.reason]],
    ['Gittiği okul', withdrawal.targetSchool ?? '—'],
  ])
  doc.section('Hesap')
  const extraBalance = breakdown.extras.reduce(
    (sum, line) => sum + line.paidCents - line.usedCents,
    0,
  )
  doc.fields([
    ['Hesap tabanı (net ücret)', money(breakdown.baseCents)],
    [`Kesinti (%${String(breakdown.deductionBasisPoints / 100)})`, money(breakdown.deductionCents)],
    [
      `Kullanım (${String(breakdown.attendedUnits)} / ${String(breakdown.totalUnits)})`,
      money(breakdown.usageCents),
    ],
    ['Hak edilen', money(breakdown.entitledCents)],
    ['Ödenen öğrenim ücreti', money(breakdown.paidCents)],
    ['Ek hizmet bakiyesi', money(extraBalance)],
    ['Dağıtılmamış tahsilat', money(breakdown.creditCents)],
    ['İade', money(withdrawal.refundCents)],
    ['Kalan borç', money(withdrawal.debtCents)],
  ])
  doc.section('Ödeme')
  doc.fields([
    ['İade son günü', dateLabel(withdrawal.refundDueDate, DAY)],
    [
      'Ödeme tarihi',
      withdrawal.refundPaidDate ? dateLabel(withdrawal.refundPaidDate, DAY) : 'Ödenmedi',
    ],
    ['Hesap sahibi', withdrawal.refundAccountHolder ?? '—'],
    ['IBAN', withdrawal.maskedIban ?? '—'],
  ])
  return doc.finish()
}
