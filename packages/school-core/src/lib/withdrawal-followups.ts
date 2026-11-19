import type { State } from '../data/seed.ts'
import type { MakeId } from './domain.ts'
import {
  applyParticipationCancel,
  holdsSeat,
  type PaidActivityTerms,
  type ParticipationCancelPlan,
  type ParticipationStatus,
} from './finance-paid-activities.ts'
import { dateLabel, money } from './format.ts'
import {
  quoteWithdrawal,
  withdrawStudent,
  withdrawStudentSchema,
  type WithdrawalActivityLine,
  type WithdrawalBreakdown,
  type WithdrawalClawbackLine,
  type WithdrawalContext,
  type WithdrawalContractLine,
} from './withdrawals.ts'

/**
 * Ayrılışın sözleşme dışı izleri (ON-342; docs/domain/finans.md DOM-FIN-040, DOM-FIN-098,
 * DOM-FIN-025; K-348…K-351). Ayrılış hesabı (`withdrawals.ts`) sözleşmeleri netleştirir; bu dosya
 * gezi ve etkinlik katılımlarını ekler ve dökümün burs ile etkinlik bölümlerini yazar.
 *
 * - Etkinlik günü ayrılış gününden sonra olan katılım aynı işlemde katılımcı iptali gibi kapanır,
 *   etkinliğin iade kuralı ayrılış gününe göre uygulanır (`applyParticipationCancel`, K-348).
 *   Etkinlik günü ayrılış günü ya da önceyse etkinlik gerçekleşmiştir; ödenmemiş kısım borç kalır.
 * - Etkinlik iadesi ve borcu ayrılışın iade ve borç bakiyesine girmez (K-349): iade katılım
 *   kaydından ödenir (K-303), borç sözleşmesiz etkinlik taksitidir.
 * - Taksiti olmayan yedek ve izin bekleyen katılım (K-369, K-370), etkinlik günü ayrılış gününden
 *   sonraysa aynı işlemde parasız iptal edilir (K-395); dökümde satır açmaz. Asil ya da izin
 *   bekleyenin boşalttığı yere sıradaki yedek geçer (`freesSeat`; geçişi servis yazar).
 *
 * `withdrawals.ts` bu dosyayı içe aktarmaz: `finance-paid-activities.ts` iade ödemesi için
 * `withdrawals.ts`'i kullanır, ters yön döngü kurardı.
 */

/**
 * Öğrencinin hesaba giren katılımı: iptal edilmemiş (asil, izin bekleyen, yedek) ya da kesinti
 * taksiti açık iptal edilmiş. Yedek ve izin bekleyenin taksiti yoktur (K-369, K-370).
 */
export interface WithdrawalActivityParticipation {
  participantId: string
  activityId: string
  studentId: string
  name: string
  status: ParticipationStatus
  invoiceId: string | null
  feeCents: number
  /** Önceki iptalin kesinti taksiti; yalnız iptal edilmiş katılımda. */
  debtInvoiceId: string | null
  activity: Pick<
    PaidActivityTerms,
    | 'activityDate'
    | 'cancelDeadline'
    | 'lateRefundRule'
    | 'lateRefundPercent'
    | 'lateCostCents'
    | 'feeCents'
  >
}

export interface WithdrawalFollowupContext extends WithdrawalContext {
  participations?: readonly WithdrawalActivityParticipation[]
}

/** Ayrılışla iptal edilen katılımın kaydı; servis katılım satırına yazar. */
export interface WithdrawalActivityCancel {
  participantId: string
  activityId: string
  plan: ParticipationCancelPlan
  /** Katılım kontenjandan yer tutuyordu (asil, izin bekleyen); yere sıradaki yedek geçer (K-369). */
  freesSeat: boolean
}

/** Önizlemede açılmayacak taksitin yer tutucu kimliği; satıra yazılmaz. */
const previewId: MakeId = () => 'onizleme'

/**
 * Katılımların ayrılış sonucu. Verilen State'in taksitleri değişir (iptal edilen katılımın
 * ödenmemiş taksiti kapanır, kesinti farkı yeni taksit olur); önizleme kopya verir.
 */
function activityOutcomes(
  state: Pick<State, 'invoices'>,
  participations: readonly WithdrawalActivityParticipation[],
  withdrawalDate: string,
  allocated: ReadonlyMap<string, number>,
  makeId: MakeId | null,
): { lines: WithdrawalActivityLine[]; cancels: WithdrawalActivityCancel[] } {
  const lines: WithdrawalActivityLine[] = []
  const cancels: WithdrawalActivityCancel[] = []
  const ordered = [...participations].sort(
    (a, b) =>
      a.activity.activityDate.localeCompare(b.activity.activityDate) ||
      a.participantId.localeCompare(b.participantId),
  )
  for (const item of ordered) {
    const head = {
      participantId: item.participantId,
      activityId: item.activityId,
      name: item.name,
      activityDate: item.activity.activityDate,
    }
    const upcoming = item.activity.activityDate > withdrawalDate
    if (item.status === 'waitlisted' || item.status === 'awaiting_consent') {
      // Taksitsiz katılım parasız kapanır, dökümde satır açmaz (K-395).
      if (upcoming)
        cancels.push({
          participantId: item.participantId,
          activityId: item.activityId,
          freesSeat: holdsSeat(item.status),
          plan: applyParticipationCancel(
            state,
            item.activity,
            {
              studentId: item.studentId,
              status: item.status,
              invoiceId: null,
              feeCents: item.feeCents,
            },
            { today: withdrawalDate, kind: 'participant', allocated, makeId: makeId ?? previewId },
          ),
        })
      continue
    }
    if (item.status === 'active' && item.invoiceId !== null && upcoming) {
      const plan = applyParticipationCancel(
        state,
        item.activity,
        {
          studentId: item.studentId,
          status: 'active',
          invoiceId: item.invoiceId,
          feeCents: item.feeCents,
        },
        { today: withdrawalDate, kind: 'participant', allocated, makeId: makeId ?? previewId },
      )
      cancels.push({
        participantId: item.participantId,
        activityId: item.activityId,
        freesSeat: true,
        plan,
      })
      lines.push({
        ...head,
        outcome: 'cancelled',
        invoiceId: item.invoiceId,
        amountCents: item.feeCents,
        paidCents: plan.paidCents,
        retainedCents: plan.retainedCents,
        refundCents: plan.refundCents,
        openCents:
          plan.closedInvoiceId === null ? 0 : Math.max(plan.retainedCents - plan.paidCents, 0),
        ...(plan.debtInvoiceId === null || makeId === null
          ? {}
          : { debtInvoiceId: plan.debtInvoiceId }),
      })
      continue
    }
    // Gerçekleşmiş etkinliğin katılım taksiti ya da önceki iptalin kesinti taksiti borç kalır.
    const invoiceId = item.status === 'active' ? item.invoiceId : item.debtInvoiceId
    const invoice =
      invoiceId === null ? undefined : state.invoices.find((entry) => entry.id === invoiceId)
    if (invoice === undefined) continue
    const paidCents = invoice.paidAt
      ? invoice.amount
      : Math.min(invoice.amount, allocated.get(invoice.id) ?? 0)
    if (invoice.amount - paidCents <= 0) continue
    lines.push({
      ...head,
      outcome: 'held',
      invoiceId: invoice.id,
      amountCents: invoice.amount,
      paidCents,
      retainedCents: 0,
      refundCents: 0,
      openCents: invoice.amount - paidCents,
    })
  }
  return { lines, cancels }
}

const withActivities = <T extends WithdrawalBreakdown>(
  breakdown: T,
  lines: readonly WithdrawalActivityLine[],
): T => (lines.length === 0 ? breakdown : { ...breakdown, activities: [...lines] })

/**
 * Ayrılış önizlemesi (DOM-FIN-040) ve katılımların ayrılış sonucu (K-348). Saf işlemdir, State
 * değişmez.
 */
export function quoteWithdrawalWithFollowups(
  state: State,
  studentId: string,
  input: unknown,
  context: WithdrawalFollowupContext,
) {
  const quote = quoteWithdrawal(state, studentId, input, context)
  const { lines } = activityOutcomes(
    { invoices: [...state.invoices] },
    context.participations ?? [],
    quote.breakdown.withdrawalDate,
    context.allocated,
    null,
  )
  return { ...quote, breakdown: withActivities(quote.breakdown, lines) }
}

/**
 * Ayrılışı uygular (DOM-FIN-041) ve gerçekleşmemiş etkinlik katılımlarını aynı işlemde iptal eder
 * (K-348; yedek ve izin bekleyen parasız, K-395). Katılım denetimi (taksiti bulunamayan katılım 409) ayrılış yazılmadan önce kopyada
 * yapılır; hata olursa State değişmez.
 */
export function withdrawStudentWithFollowups(
  state: State,
  studentId: string,
  input: unknown,
  makeId: MakeId,
  context: WithdrawalFollowupContext,
) {
  const participations = context.participations ?? []
  const { withdrawalDate } = withdrawStudentSchema.parse(input)
  activityOutcomes(
    { invoices: [...state.invoices] },
    participations,
    withdrawalDate,
    context.allocated,
    null,
  )
  const result = withdrawStudent(state, studentId, input, makeId, context)
  const { lines, cancels } = activityOutcomes(
    state,
    participations,
    result.withdrawalDate,
    context.allocated,
    makeId,
  )
  return {
    ...result,
    breakdown: withActivities(result.breakdown, lines),
    activityCancels: cancels,
  }
}

export interface WithdrawalFollowupSection {
  title: string
  /** Bölümün tutarlarının ayrılış bakiyesine girmediğini söyleyen not; yoksa boş. */
  note: string | null
  rows: (readonly [string, string])[]
}

const DAY = { year: 'numeric' } as const

function activityValue(line: WithdrawalActivityLine): string {
  if (line.outcome === 'held') return `Gerçekleşti; açık borç ${money(line.openCents)}`
  if (line.refundCents > 0) return `Katılım iptal edildi; iade ${money(line.refundCents)}`
  if (line.openCents > 0) return `Katılım iptal edildi; kesinti borcu ${money(line.openCents)}`
  return 'Katılım iptal edildi; iade ve borç yok'
}

/**
 * Dökümün burs ve etkinlik bölümleri; ekran ve iade belgesi aynı sözleri kullanır (IST-110).
 * Eski kayıtta alanlar olmadığından boş döner, döküm değişmez.
 */
export function withdrawalFollowupSections(breakdown: {
  contracts?: readonly WithdrawalContractLine[] | undefined
  scholarshipClawbacks?: readonly WithdrawalClawbackLine[] | undefined
  activities?: readonly WithdrawalActivityLine[] | undefined
}): WithdrawalFollowupSection[] {
  const sections: WithdrawalFollowupSection[] = []
  const contracts = breakdown.contracts ?? []
  const clawbacks = breakdown.scholarshipClawbacks ?? []
  const scholarshipRows = contracts.flatMap((line): (readonly [string, string])[] => {
    const end = line.scholarshipEnd
    if (end === undefined) return []
    const title = contracts.length > 1 ? ` · ${line.title}` : ''
    const label = `${end.kind === 'revoke' ? 'Burs iptal edildi' : 'Burs kesildi'} (${dateLabel(end.effectiveDate, DAY)})${title}`
    return [
      [
        label,
        end.reinstatedCents > 0
          ? `Kalkan pay ${money(end.reinstatedCents)} tabana eklendi; burslu istisnası yok`
          : 'Burslu istisnası yok',
      ],
    ]
  })
  const clawbackRows = clawbacks.flatMap((line): (readonly [string, string])[] => [
    ['Geri istenen burs', money(line.principalCents)],
    ['Kanuni faiz', money(line.interestCents)],
    ['Geri isteme alacağında açık', money(line.openCents)],
  ])
  if (scholarshipRows.length + clawbackRows.length > 0)
    sections.push({
      title: 'Burs',
      note:
        clawbacks.length > 0
          ? 'Geri istenen burs alacağı iade ve kalan borca girmez; ayrıca tahsil edilir.'
          : null,
      rows: [...scholarshipRows, ...clawbackRows],
    })
  const activities = breakdown.activities ?? []
  if (activities.length > 0)
    sections.push({
      title: 'Gezi ve etkinlik',
      note: 'Etkinlik iadesi ve borcu iade ve kalan borca girmez: iade katılım kaydından ödenir, borç ayrıca tahsil edilir.',
      rows: activities.map((line) => [
        `${line.name} (${dateLabel(line.activityDate, DAY)})`,
        activityValue(line),
      ]),
    })
  return sections
}
