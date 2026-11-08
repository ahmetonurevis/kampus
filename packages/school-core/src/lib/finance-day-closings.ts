import { z } from 'zod'

import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import { parseAmountInput, PAYMENT_METHODS, type PaymentMethod } from './payments.ts'

/**
 * Kasa ve gün sonu (IST-113; docs/domain/finans.md DOM-FIN-036). Gün Europe/Istanbul günüdür, para
 * kuruştur. Tahsilat ödeme gününe, iptal iptal gününe yazılır (DOM-FIN-033, DOM-FIN-054): geçmiş
 * günün tahsilatı bugün iptal edilirse kapatılmış gün değişmez, ters kayıt bugünün raporuna düşer.
 * Kapanış satırı raporun o anki özetini taşır; yeniden açma satırı silmez, yeni kapanış yeni satırdır.
 * Ödenen ayrılış iadesi ödeme gününe banka yönteminde "iade ödemesi" olarak yazılır ve netten düşer
 * (M-13, DOM-FIN-041); nakit iade yoktur.
 */

/** Günü kapatan roller (DOM-FIN-036). Kapatma tahsilat kaydıyla aynı görevlilerdedir. */
export const FINANCE_DAY_CLOSE_ROLES = ['yonetici', 'onburo'] as const
/** Kapatılmış günü yalnız yönetici gerekçeyle yeniden açar; onay ile kayıt aynı kişide toplanmaz. */
export const FINANCE_DAY_REOPEN_ROLES = ['yonetici'] as const

const CASH: PaymentMethod = 'Nakit'
/** İade kurumun bildirilmiş banka hesabından havaleyle ödenir (M-13); gün sonunda bu yöntemdedir. */
export const REFUND_PAYMENT_METHOD: PaymentMethod = 'Banka havalesi'
/** Kasa sayımının üst sınırı; tek tahsilat sınırından geniştir, kapanışı engellemesin diye. */
const MAX_CASH_CENTS = 1_000_000_000

const cashCents = z
  .number()
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(0, 'Kasa tutarı sıfırdan küçük olamaz.')
  .max(MAX_CASH_CENTS, 'Kasa tutarı en fazla 10.000.000 ₺ olabilir.')

export const closeFinanceDaySchema = z
  .strictObject({
    reportStamp: z.string().min(1, 'Raporu yenileyip yeniden deneyin.').max(100),
    openingCashCents: cashCents.optional(),
    countedCashCents: cashCents.optional(),
    // kvkk: Ç
    note: z
      .string()
      .trim()
      .min(5, 'Açıklama en az 5 karakter olmalıdır.')
      .max(500, 'Açıklama en fazla 500 karakter olabilir.')
      .optional(),
  })
  .refine((value) => value.openingCashCents === undefined || value.countedCashCents !== undefined, {
    path: ['countedCashCents'],
    message: 'Sayılan nakdi girin.',
  })
export type CloseFinanceDayInput = z.input<typeof closeFinanceDaySchema>

export const reopenFinanceDaySchema = z.strictObject({
  // kvkk: Ç
  reason: z
    .string()
    .trim()
    .min(5, 'Yeniden açma gerekçesi en az 5 karakter olmalıdır.')
    .max(500, 'Yeniden açma gerekçesi en fazla 500 karakter olabilir.'),
})
export type ReopenFinanceDayInput = z.input<typeof reopenFinanceDaySchema>

/** Kasa sayımı metnini kuruşa çevirir; tahsilat tutarından farklı olarak sıfır geçerlidir. */
export const parseCashCountInput = (text: string): number | null =>
  parseAmountInput(text, { allowZero: true, maxCents: MAX_CASH_CENTS })

/** Gün sonu formu (web): tutarlar metindir, gönderimde kuruşa çevrilir. */
export const financeDayFormSchema = z
  .object({ openingCash: z.string(), countedCash: z.string(), note: z.string().trim().max(500) })
  .superRefine((value, context) => {
    for (const field of ['openingCash', 'countedCash'] as const)
      if (value[field].trim() !== '' && parseCashCountInput(value[field]) === null)
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Tutarı 1.234,56 biçiminde girin.',
        })
    if (value.openingCash.trim() !== '' && value.countedCash.trim() === '')
      context.addIssue({ code: 'custom', path: ['countedCash'], message: 'Sayılan nakdi girin.' })
  })
export type FinanceDayFormValues = z.output<typeof financeDayFormSchema>

/** Özetin okuduğu tahsilat alanları; depo ve testler aynı şekli verir. */
export interface FinanceDayPayment {
  amountCents: number
  method: PaymentMethod
  paidAt: string
  reversedAt: string | null
}

/** Özetin okuduğu ödenmiş iade alanları; `paidDate` iadenin ödeme günüdür (Europe/Istanbul). */
export interface FinanceDayRefund {
  amountCents: number
  paidDate: string
}

export interface FinanceDayMethodTotal {
  method: PaymentMethod
  collectedCount: number
  collectedCents: number
  reversedCount: number
  reversedCents: number
  /** O gün ödenen iade adedi; yalnız `REFUND_PAYMENT_METHOD` satırında sıfırdan büyük olur. */
  refundPaidCount: number
  refundPaidCents: number
  /** Tahsilat − iptal − iade ödemesi. */
  netCents: number
}

export interface FinanceDaySummary {
  /** Her yöntem hareket olmasa da yer alır; sıra `PAYMENT_METHODS` sırasıdır. */
  methods: FinanceDayMethodTotal[]
  collectedCount: number
  collectedCents: number
  reversedCount: number
  reversedCents: number
  refundPaidCount: number
  refundPaidCents: number
  netCents: number
}

/** O güne yazılan tahsilat ve iptal satırları; ikisi de o günse tahsilat iki listede de görünür. */
export function financeDayLines<T extends FinanceDayPayment>(
  payments: readonly T[],
  day: string,
): { collected: T[]; reversed: T[] } {
  return {
    collected: payments.filter((payment) => dayKey(payment.paidAt) === day),
    reversed: payments.filter(
      (payment) => payment.reversedAt !== null && dayKey(payment.reversedAt) === day,
    ),
  }
}

/** O gün ödenen iadeler (M-13); ödeme günü gün anahtarıdır. */
export const financeDayRefunds = <T extends FinanceDayRefund>(
  refunds: readonly T[],
  day: string,
): T[] => refunds.filter((refund) => refund.paidDate === day)

const centsOf = (lines: readonly { amountCents: number }[]) =>
  lines.reduce((total, line) => total + line.amountCents, 0)

/**
 * Yöntem bazında gün özeti; net = tahsilat − o gün yapılan iptaller − o gün ödenen iadeler
 * (DOM-FIN-036, M-13). İade banka yöntemine yazılır; nakit ve kasa beklenenine dokunmaz.
 */
export function financeDaySummary(
  payments: readonly FinanceDayPayment[],
  day: string,
  refunds: readonly FinanceDayRefund[] = [],
): FinanceDaySummary {
  const { collected, reversed } = financeDayLines(payments, day)
  const refunded = financeDayRefunds(refunds, day)
  const methods = PAYMENT_METHODS.map((method): FinanceDayMethodTotal => {
    const collectedLines = collected.filter((line) => line.method === method)
    const reversedLines = reversed.filter((line) => line.method === method)
    const refundLines = method === REFUND_PAYMENT_METHOD ? refunded : []
    return {
      method,
      collectedCount: collectedLines.length,
      collectedCents: centsOf(collectedLines),
      reversedCount: reversedLines.length,
      reversedCents: centsOf(reversedLines),
      refundPaidCount: refundLines.length,
      refundPaidCents: centsOf(refundLines),
      netCents: centsOf(collectedLines) - centsOf(reversedLines) - centsOf(refundLines),
    }
  })
  return {
    methods,
    collectedCount: collected.length,
    collectedCents: centsOf(collected),
    reversedCount: reversed.length,
    reversedCents: centsOf(reversed),
    refundPaidCount: refunded.length,
    refundPaidCents: centsOf(refunded),
    netCents: centsOf(collected) - centsOf(reversed) - centsOf(refunded),
  }
}

/**
 * Raporun damgası: görevli ekrandaki raporla kapatır. Ekran açıkken başka biri tahsilat girer,
 * iptal eder ya da iade öderse damga tutmaz ve kapanış reddedilir; görmediği rakam mühürlenmez.
 */
export const financeDayStamp = (summary: FinanceDaySummary): string =>
  [summary.collectedCount, summary.reversedCount, summary.refundPaidCount, summary.netCents].join(
    ':',
  )

const cashTotal = (summary: FinanceDaySummary) =>
  summary.methods.find((item) => item.method === CASH)

/** Günün net nakit hareketi; beklenen kasa bunun üstüne kurulur. */
export const financeDayCashNet = (summary: FinanceDaySummary): number =>
  cashTotal(summary)?.netCents ?? 0

/** Nakit açıksa ya da o gün nakit hareketi olduysa sayım zorunludur (DOM-FIN-032, DOM-FIN-036). */
export function isCashCountRequired(summary: FinanceDaySummary, cashEnabled: boolean): boolean {
  const cash = cashTotal(summary)
  return cashEnabled || (cash?.collectedCount ?? 0) > 0 || (cash?.reversedCount ?? 0) > 0
}

export interface FinanceDayCash {
  openingCents: number
  countedCents: number
  /** Açılış + günün net nakdi; iptal edilen nakit kasadan çıkmış sayılır. */
  expectedCents: number
  /** Sayılan − beklenen: artı fazla, eksi eksik. */
  differenceCents: number
}

export interface FinanceDayClosingContext {
  today: string
  /** Gün şu an kapalı mı (yeniden açılmamış kapanış var mı). */
  alreadyClosed: boolean
  cashEnabled: boolean
  /** Önceki kapanışta sayılan nakit; hiç kapanış yoksa boş. */
  suggestedOpeningCents: number | null
}

export interface FinanceDayClosingPlan {
  closingDate: string
  summary: FinanceDaySummary
  cash: FinanceDayCash | null
  note: string | null
}

/** Rapor ve kapanış bugünden ileri bir gün için yapılmaz. */
export function assertFinanceDayReportable(day: string, today: string): void {
  if (day > today)
    throw new DomainError('finance_day_in_future', 'İleri bir gün için gün sonu alınamaz.')
}

/**
 * Gün kapanışını planlar (DOM-FIN-036): ileri gün reddedilir, kapalı gün ikinci kez kapatılmaz,
 * ekrandaki rapor değiştiyse kapanış durur. Kasa farkı ve önceki kapanıştan farklı açılış
 * açıklama ister; rakam düzeltilmez, gerekçesiyle kayda geçer.
 */
export function planFinanceDayClosing(
  closingDate: string,
  summary: FinanceDaySummary,
  input: unknown,
  context: FinanceDayClosingContext,
): FinanceDayClosingPlan {
  const data = closeFinanceDaySchema.parse(input)
  assertFinanceDayReportable(closingDate, context.today)
  if (context.alreadyClosed)
    throw new DomainError('finance_day_already_closed', 'Bu gün zaten kapatılmış.', {
      kind: 'conflict',
    })
  if (data.reportStamp !== financeDayStamp(summary))
    throw new DomainError(
      'finance_day_report_changed',
      'Rapor siz bakarken değişti. Güncel rakamları kontrol edip yeniden deneyin.',
      { kind: 'conflict' },
    )
  const note = data.note ?? null
  if (data.countedCashCents === undefined) {
    if (isCashCountRequired(summary, context.cashEnabled))
      throw new DomainError('cash_count_required', 'Kasadaki nakdi sayıp girin.', {
        path: ['countedCashCents'],
      })
    return { closingDate, summary, cash: null, note }
  }
  const openingCents = data.openingCashCents ?? context.suggestedOpeningCents ?? 0
  const expectedCents = openingCents + financeDayCashNet(summary)
  const differenceCents = data.countedCashCents - expectedCents
  if (differenceCents !== 0 && note === null)
    throw new DomainError('cash_difference_note_required', 'Kasa farkını açıklayın.', {
      path: ['note'],
    })
  if (
    context.suggestedOpeningCents !== null &&
    openingCents !== context.suggestedOpeningCents &&
    note === null
  )
    throw new DomainError(
      'opening_cash_note_required',
      'Açılış kasası önceki kapanıştan farklı; nedenini açıklayın.',
      { path: ['note'] },
    )
  return {
    closingDate,
    summary,
    cash: { openingCents, countedCents: data.countedCashCents, expectedCents, differenceCents },
    note,
  }
}

/** Yalnız kapalı gün yeniden açılır; satır silinmez, gerekçe aynı satıra yazılır (DOM-FIN-036). */
export function planFinanceDayReopen(isClosed: boolean, input: unknown): { reason: string } {
  const { reason } = reopenFinanceDaySchema.parse(input)
  if (!isClosed)
    throw new DomainError('finance_day_not_closed', 'Bu gün kapatılmamış.', { kind: 'conflict' })
  return { reason }
}

/**
 * Kapatılmış güne tahsilat girilmez (IST-113 kabul ölçütü). `paidDate` forma yazıldığı için hata
 * oraya gider; o gün için düzeltme yöneticinin günü yeniden açmasıyla yapılır.
 */
export function assertPaymentDayOpen(isClosed: boolean): void {
  if (isClosed)
    throw new DomainError(
      'finance_day_closed',
      'Bu günün kasası kapatılmış; bu güne tahsilat girilemez. Yöneticinin günü yeniden açması gerekir.',
      { path: ['paidDate'] },
    )
}

/**
 * Düzeltme kaydı (iptal) iptal gününe yazılır (DOM-FIN-033): geçmiş günün tahsilatı iptal edilebilir,
 * kapatılmış gün değişmez. Bugünün kendisi kapalıysa iptal o günü değiştireceği için reddedilir.
 */
export function assertReversalDayOpen(isClosed: boolean): void {
  if (isClosed)
    throw new DomainError(
      'finance_day_closed',
      'Bugünün kasası kapatılmış; iptal için yöneticinin günü yeniden açması gerekir.',
    )
}
