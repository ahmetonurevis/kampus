// İade hesap kırılımı: veri ayrılış kaydından gelir, hesap burada yeniden yazılmaz (DOM-FIN-040, -041; IST-110).
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  contractLineRows,
  contractLinesToShow,
  paidTuitionLabel,
  WITHDRAWAL_PAYER_LABELS,
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalContractLine,
  type WithdrawalPayer,
  withdrawalTargetLabel,
  type WithdrawalReason,
} from '@kampus/school-core/lib/withdrawals.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { learnerTerm, type LearnerTermOptions } from './finance-shared.ts'
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
  /** İadenin ödendiği kurum hesabı (M-13); eski kayıtta ve ödenmemiş iadede yok. */
  refundBankAccountLabel?: string | null
  breakdown: {
    baseCents: number
    deductionBasisPoints: number
    deductionCents: number
    attendedUnits: number
    totalUnits: number
    usageCents: number
    entitledCents: number
    scholarshipExempt?: boolean
    paidCents: number
    creditCents: number
    extras: readonly { kind: string; paidCents: number; usedCents: number }[]
    contracts?: readonly WithdrawalContractLine[]
    /** Gerekçe belgeye yazılmaz; yalnız iadeyi alacak ödeyici (K-12). */
    payerDecision?: { payer: WithdrawalPayer }
  }
}

const DAY = { year: 'numeric' } as const

/**
 * İade hesap kırılımı: karar anındaki döküm aynen yazılır (DOM-FIN-041, IST-110). Ayrılan kayıt
 * okulda "Öğrenci", dil okulu ve kursta "Kursiyer" diye yazılır; gidilen yer ve ödenen ücret de
 * okulda "okul" ve "öğrenim ücreti", öteki türlerde "kurum" ve "kurs ücreti"dir (DOM-KAY-012).
 */
export function refundStatementDocument(
  measurer: TextMeasurer,
  withdrawal: RefundWithdrawal,
  options: TemplateOptions & LearnerTermOptions,
): PdfDocument {
  const { breakdown } = withdrawal
  const type = options.institutionType
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
    [learnerTerm(type), withdrawal.studentName ?? '—'],
    ['Ayrılış tarihi', dateLabel(withdrawal.withdrawalDate, DAY)],
    ['Ayrılış nedeni', WITHDRAWAL_REASON_LABELS[withdrawal.reason]],
    [withdrawalTargetLabel(type), withdrawal.targetSchool ?? '—'],
  ])
  const contractLines = contractLinesToShow(breakdown.contracts)
  if (contractLines.length > 0) {
    // Birden çok sözleşmede ve pakette toplam satırı kullanımı anlatamaz (K-06).
    for (const line of contractLines) {
      doc.section(line.title)
      doc.fields(contractLineRows(line, breakdown.deductionBasisPoints, undefined, type))
    }
    doc.section('Toplam')
    doc.fields([
      ['Dağıtılmamış tahsilat', money(breakdown.creditCents)],
      ...(breakdown.payerDecision
        ? ([
            ['İadeyi alacak ödeyici', WITHDRAWAL_PAYER_LABELS[breakdown.payerDecision.payer]],
          ] as const)
        : []),
      ['İade', money(withdrawal.refundCents)],
      ['Kalan borç', money(withdrawal.debtCents)],
    ])
  } else {
    doc.section('Hesap')
    const extraBalance = breakdown.extras.reduce(
      (sum, line) => sum + line.paidCents - line.usedCents,
      0,
    )
    doc.fields([
      ['Hesap tabanı (net ücret)', money(breakdown.baseCents)],
      [
        `Kesinti (%${String(breakdown.deductionBasisPoints / 100)})`,
        money(breakdown.deductionCents),
      ],
      [
        `Kullanım (${String(breakdown.attendedUnits)} / ${String(breakdown.totalUnits)})`,
        money(breakdown.usageCents),
      ],
      ['Hak edilen', money(breakdown.entitledCents)],
      ...(breakdown.scholarshipExempt
        ? ([['Burslu istisnası', 'Ödenenden fazlası istenmez']] as const)
        : []),
      [paidTuitionLabel(type), money(breakdown.paidCents)],
      ['Ek hizmet bakiyesi', money(extraBalance)],
      ['Dağıtılmamış tahsilat', money(breakdown.creditCents)],
      ['İade', money(withdrawal.refundCents)],
      ['Kalan borç', money(withdrawal.debtCents)],
    ])
  }
  doc.section('Ödeme')
  doc.fields([
    ['İade son günü', dateLabel(withdrawal.refundDueDate, DAY)],
    [
      'Ödeme tarihi',
      withdrawal.refundPaidDate ? dateLabel(withdrawal.refundPaidDate, DAY) : 'Ödenmedi',
    ],
    ['Hesap sahibi', withdrawal.refundAccountHolder ?? '—'],
    ['IBAN', withdrawal.maskedIban ?? '—'],
    ...(withdrawal.refundBankAccountLabel
      ? ([['Ödendiği kurum hesabı', withdrawal.refundBankAccountLabel]] as const)
      : []),
  ])
  return doc.finish()
}
