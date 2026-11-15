import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isContractInForce } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import { learnerWords } from './enrollment-learner.ts'
import { DomainError } from './errors.ts'
import { legalInterest, type LegalInterestSegment } from './finance-legal-interest.ts'
import { dateLabel, dayKey, money } from './format.ts'
import { invoicesOf } from './withdrawals.ts'

/**
 * Burs kesilmesi ve gerçek dışı beyanda iptal ile geri isteme (docs/domain/finans.md DOM-FIN-025;
 * IST-105; ON-283; K-264…K-267). İki işlem vardır:
 *
 * - **Kesme** ileriye etkilidir: yönetici gerekçeyle keser, kesme gününden sonra vadesi gelen
 *   taksitlerin burs payı ayrı öğrenim taksiti olarak yazılır; önceki dönemde uygulanan burs
 *   geri istenmez.
 * - **İptal** geriye etkilidir: bugüne kadar uygulanan burs payı kanuni faiziyle (3095 sayılı Kanun)
 *   ayrı alacak olarak geri istenir, bundan sonraki taksitlerde burs kalkar.
 *
 * Burs payı taksitlere net ile aynı oranda yayılmış sayılır (`scholarshipShareSchedule`). Onaylı
 * sözleşmenin tutarı ve planı değişmez (DOM-FIN-010): yeni alacak yeni taksittir. Hesap saf ve
 * `now` parametrelidir; hukuk varsayımları **doğrulanmalı** (H-32).
 */

export const SCHOLARSHIP_TERMINATION_REASONS = [
  'discipline',
  'academic',
  'attendance',
  'institution_decision',
  'other',
] as const
export type ScholarshipTerminationReason = (typeof SCHOLARSHIP_TERMINATION_REASONS)[number]
export type ScholarshipEndReason = ScholarshipTerminationReason | 'false_declaration'
export const SCHOLARSHIP_END_REASON_LABELS: Readonly<Record<ScholarshipEndReason, string>> = {
  discipline: 'Disiplin',
  academic: 'Başarı şartı',
  attendance: 'Devamsızlık',
  institution_decision: 'Kurum kararı',
  other: 'Diğer',
  false_declaration: 'Gerçek dışı beyan',
}

export const SCHOLARSHIP_END_KINDS = ['terminate', 'revoke'] as const
export type ScholarshipEndKind = (typeof SCHOLARSHIP_END_KINDS)[number]
export const SCHOLARSHIP_END_KIND_LABELS: Readonly<Record<ScholarshipEndKind, string>> = {
  terminate: 'Kesildi',
  revoke: 'İptal edildi, geri istendi',
}

/** Geri isteme alacağının ödeme süresi, gün (K-266). */
export const SCHOLARSHIP_CLAWBACK_PAYMENT_DAYS = 30
/** Tam bursta burs eğitim yılının Eylül–Haziran on ayına yayılır (K-264). */
const FULL_SCHOLARSHIP_MONTHS = 10
const DAY_TIME = 'T09:00:00.000Z'

// kvkk: K — gerekçe açıklaması serbest metindir; loglanmaz, denetime yalnız alan adı düşer.
const noteSchema = requiredText.max(1000, 'En fazla 1000 karakter girebilirsiniz.')
/** Önizlemede gösterilen yeni alacak toplamı; sunucu hesabı değiştiyse 409 (K-265). */
const confirmedSchema = z.number('Önizlemedeki tutarı onaylayın.').int().min(0).max(100_000_000_00)

export const terminateScholarshipSchema = z.strictObject({
  reason: z.enum(SCHOLARSHIP_TERMINATION_REASONS, 'Kesme nedenini seçin.'),
  note: noteSchema,
  effectiveDate: daySchema,
  confirmedCents: confirmedSchema,
})
export type TerminateScholarshipInput = z.input<typeof terminateScholarshipSchema>

export const revokeScholarshipSchema = z.strictObject({
  note: noteSchema,
  confirmedCents: confirmedSchema,
})
export type RevokeScholarshipInput = z.input<typeof revokeScholarshipSchema>

export const scholarshipEndQuoteSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('terminate'), effectiveDate: daySchema }),
    z.strictObject({ kind: z.literal('revoke') }),
  ],
  'İşlem türünü seçin.',
)
export type ScholarshipEndQuoteInput = z.input<typeof scholarshipEndQuoteSchema>

/** Atamanın hesaba giren alanları (`scholarship_awards`). */
export interface ScholarshipEndAward {
  id: string
  programId: string
  studentId: string
  academicYear: number
}

/** Atamanın önceki kesme ya da iptal kaydı; kesmeden sonra iptal yapılabilir. */
export interface PriorScholarshipEnd {
  kind: ScholarshipEndKind
  effectiveDate: string
  invoiceIds: readonly string[]
}

/** Burs payının bir vadesi. */
export interface ScholarshipShare {
  dueDate: string
  shareCents: number
}

export type ScholarshipEndLineStatus = 'kept' | 'reinstated' | 'clawback' | 'already_reinstated'

export interface ScholarshipEndLine extends ScholarshipShare {
  status: ScholarshipEndLineStatus
  /** Geri istenen satırın kanuni faizi; öteki satırlarda sıfır. */
  interestCents: number
  interestDays: number
  segments: LegalInterestSegment[]
}

export interface ScholarshipEndQuote {
  kind: ScholarshipEndKind
  awardId: string
  contractId: string
  /** Kesme günü ya da iptal (geri isteme) günü. */
  effectiveDate: string
  scholarshipCents: number
  /** Taksiti olmayan tam burs: pay ayları sanaldır (K-264). */
  fullScholarship: boolean
  /** Kesmede önceki dönemde kalan burs; iptalde sıfır. Fon payı bu tutara iner (K-119). */
  keptCents: number
  /** İleriye kalkan burs: yeni öğrenim taksitlerinin toplamı. */
  reinstatedCents: number
  principalCents: number
  interestCents: number
  /** Yeni alacakların toplamı; komut `confirmedCents` ile aynı olmalıdır. */
  totalCents: number
  reinstated: { dueDate: string; amountCents: number }[]
  clawbackDueDate: string | null
  lines: ScholarshipEndLine[]
}

type Contract = State['contracts'][number]

const DAY_MS = 86_400_000
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}${DAY_TIME}`) + days * DAY_MS).toISOString().slice(0, 10)
const isTuition = (line: { feeKind?: string | undefined }) =>
  (line.feeKind ?? 'tuition') === 'tuition'
/** Eğitim yılının son günü (31 Ağustos); kesme günü bu yılın içinde olmalıdır. */
export const academicYearLastDay = (academicYear: number) => `${String(academicYear + 1)}-08-31`

/**
 * Burs payının vadeleri (K-264). Öğrenim taksiti varsa pay taksit tutarlarıyla orantılıdır (net ile
 * aynı oran), yoksa (tam burs) eğitim yılının Eylül–Haziran on ayına eşit yayılır, vade ayın
 * birincisidir. Kuruş farkı en büyük kalan yöntemiyle dağıtılır; eşitlikte önceki vade alır. Payların
 * toplamı burs tutarına kuruşu kuruşuna eşittir.
 */
export function scholarshipShareSchedule(
  scholarshipCents: number,
  tuition: readonly { dueDate: string; amountCents: number }[],
  academicYear: number,
): ScholarshipShare[] {
  const base =
    tuition.length > 0
      ? [...tuition]
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
          .map((line) => ({ dueDate: line.dueDate, weight: line.amountCents }))
      : Array.from({ length: FULL_SCHOLARSHIP_MONTHS }, (_, index) => ({
          dueDate: new Date(Date.UTC(academicYear, 8 + index, 1)).toISOString().slice(0, 10),
          weight: 1,
        }))
  const total = base.reduce((sum, line) => sum + BigInt(line.weight), 0n)
  if (total === 0n || scholarshipCents <= 0)
    return base.map((line) => ({ dueDate: line.dueDate, shareCents: 0 }))
  const amount = BigInt(scholarshipCents)
  const parts = base.map((line, index) => {
    const exact = amount * BigInt(line.weight)
    return { index, dueDate: line.dueDate, floor: exact / total, remainder: exact % total }
  })
  let left = amount - parts.reduce((sum, part) => sum + part.floor, 0n)
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )
  const extra = new Set<number>()
  for (const part of order) {
    if (left <= 0n) break
    extra.add(part.index)
    left -= 1n
  }
  return parts.map((part) => ({
    dueDate: part.dueDate,
    shareCents: Number(part.floor) + (extra.has(part.index) ? 1 : 0),
  }))
}

const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/**
 * Atamanın yürürlükteki sözleşmesi: öğrencinin o yıldaki, aynı programın bursunu taşıyan sürümü.
 * Onaylanmamış ek protokol açıksa işlem yapılmaz; ek protokol onaylanınca açık taksitleri yeniden
 * yazar ve burs taksitlerini düşürürdü.
 */
function awardContract(state: State, award: ScholarshipEndAward): Contract {
  const contract = state.contracts
    .filter(
      (item) =>
        item.studentId === award.studentId &&
        item.academicYear === award.academicYear &&
        item.scholarship?.programId === award.programId &&
        isContractInForce(item, state.contracts),
    )
    .sort((a, b) => (b.revision ?? 1) - (a.revision ?? 1))[0]
  if (contract === undefined)
    throw new DomainError(
      'scholarship_contract_not_found',
      'Bursun yürürlükteki sözleşmesi bulunamadı.',
    )
  if (
    state.contracts.some(
      (item) =>
        item.amendsContractId === contract.id &&
        item.cancelledAt === undefined &&
        item.approval === undefined,
    )
  )
    throw conflict(
      'scholarship_contract_amendment_open',
      'Sözleşmenin onay bekleyen ek protokolü var; önce onu sonuçlandırın.',
    )
  return contract
}

/** Burs payının dağıldığı öğrenim taksitleri: onaylı sürümde onay anının planı (DOM-FIN-051). */
function tuitionLines(state: State, contract: Contract, excluded: ReadonlySet<string>) {
  const plan =
    contract.approval?.plan ??
    invoicesOf(state, contract).map((invoice) => ({
      invoiceId: invoice.id,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      ...(invoice.feeKind === undefined ? {} : { feeKind: invoice.feeKind }),
    }))
  return plan
    .filter((line) => isTuition(line))
    .filter((line) => line.invoiceId === null || !excluded.has(line.invoiceId))
    .map((line) => ({ dueDate: line.dueDate.slice(0, 10), amountCents: line.amount }))
}

function requireDates(
  kind: ScholarshipEndKind,
  effectiveDate: string,
  today: string,
  academicYear: number,
) {
  if (kind === 'revoke') return
  if (effectiveDate < today)
    throw new DomainError(
      'scholarship_end_date_past',
      'Kesme günü bugünden önce olamaz; kesme ileriye etkilidir.',
      { path: ['effectiveDate'] },
    )
  if (effectiveDate > academicYearLastDay(academicYear))
    throw new DomainError(
      'scholarship_end_date_out_of_year',
      'Kesme günü bursun eğitim yılı içinde olmalıdır.',
      { path: ['effectiveDate'] },
    )
}

function requirePrior(kind: ScholarshipEndKind, prior: readonly PriorScholarshipEnd[]) {
  if (prior.some((item) => item.kind === 'revoke'))
    throw conflict(
      'scholarship_already_revoked',
      'Bu burs gerçek dışı beyan nedeniyle iptal edildi.',
    )
  if (kind === 'terminate' && prior.some((item) => item.kind === 'terminate'))
    throw conflict('scholarship_already_terminated', 'Bu burs zaten kesildi.')
}

/**
 * Kesme ya da iptalin hesabı; State'i değiştirmez (önizleme ve komut aynı hesabı kullanır). Kesmede
 * kesme gününden sonra vadesi gelen pay kalkar. İptalde bugünden sonra vadesi gelen pay kalkar,
 * vadesi bugün ya da önce olan pay vade gününden bugüne kanuni faiziyle geri istenir; önceki
 * kesmenin kaldırdığı pay ikinci kez yazılmaz.
 */
export function quoteScholarshipEnd(
  state: State,
  award: ScholarshipEndAward,
  input: unknown,
  context: {
    now: string
    prior: readonly PriorScholarshipEnd[]
    institutionType?: InstitutionType | undefined
  },
): ScholarshipEndQuote {
  const data = scholarshipEndQuoteSchema.parse(input)
  const today = dayKey(context.now)
  const effectiveDate = data.kind === 'terminate' ? data.effectiveDate : today
  requirePrior(data.kind, context.prior)
  const student = state.students.find((item) => item.id === award.studentId)
  if (!student?.isActive)
    throw conflict(
      'scholarship_student_inactive',
      `${learnerWords(context.institutionType).titleGenitive} kaydı aktif değil; ayrılışta burs ayrılış hesabıyla kapanır.`,
    )
  requireDates(data.kind, effectiveDate, today, award.academicYear)
  const contract = awardContract(state, award)
  const scholarshipCents = contract.scholarship?.amountCents ?? 0
  const excluded = new Set(context.prior.flatMap((item) => item.invoiceIds))
  const tuition = tuitionLines(state, contract, excluded)
  const schedule = scholarshipShareSchedule(scholarshipCents, tuition, award.academicYear)
  const terminated = context.prior.find((item) => item.kind === 'terminate')

  const lines = schedule.map((share): ScholarshipEndLine => {
    const empty = { interestCents: 0, interestDays: 0, segments: [] }
    if (terminated !== undefined && share.dueDate > terminated.effectiveDate)
      return { ...share, ...empty, status: 'already_reinstated' }
    if (share.dueDate > effectiveDate) return { ...share, ...empty, status: 'reinstated' }
    if (data.kind === 'terminate') return { ...share, ...empty, status: 'kept' }
    const interest = legalInterest(share.shareCents, share.dueDate, effectiveDate)
    return {
      ...share,
      status: 'clawback',
      interestCents: interest.interestCents,
      interestDays: interest.days,
      segments: interest.segments,
    }
  })
  const total = (status: ScholarshipEndLineStatus, key: 'shareCents' | 'interestCents') =>
    lines.filter((line) => line.status === status).reduce((sum, line) => sum + line[key], 0)
  const reinstatedCents = total('reinstated', 'shareCents')
  const principalCents = total('clawback', 'shareCents')
  const interestCents = total('clawback', 'interestCents')
  if (reinstatedCents + principalCents === 0)
    throw new DomainError(
      'scholarship_end_no_change',
      data.kind === 'terminate'
        ? 'Kesme gününden sonra vadesi gelen burs payı yok; burs bu günden önce tamamlanıyor.'
        : 'Geri istenecek ya da kaldırılacak burs payı yok.',
      { path: data.kind === 'terminate' ? ['effectiveDate'] : [] },
    )
  return {
    kind: data.kind,
    awardId: award.id,
    contractId: contract.id,
    effectiveDate,
    scholarshipCents,
    fullScholarship: tuition.length === 0,
    keptCents: data.kind === 'terminate' ? total('kept', 'shareCents') : 0,
    reinstatedCents,
    principalCents,
    interestCents,
    totalCents: reinstatedCents + principalCents + interestCents,
    reinstated: lines
      .filter((line) => line.status === 'reinstated' && line.shareCents > 0)
      .map((line) => ({ dueDate: line.dueDate, amountCents: line.shareCents })),
    clawbackDueDate:
      principalCents > 0 ? addDays(effectiveDate, SCHOLARSHIP_CLAWBACK_PAYMENT_DAYS) : null,
    lines,
  }
}

export interface ScholarshipEndResult {
  quote: ScholarshipEndQuote
  reason: ScholarshipEndReason
  note: string
  /** Yazılan taksitler: önce ileriye kalkan burs payları, sonra anapara ve faiz alacağı. */
  invoiceIds: string[]
}

/** Sözleşme zincirindeki en büyük taksit numarası; zincirde numara tekildir. */
function chainHighestInstallment(state: State, contract: Contract): number {
  const rootOf = (item: Contract): Contract => {
    const base = state.contracts.find((other) => other.id === item.amendsContractId)
    return base === undefined ? item : rootOf(base)
  }
  const root = rootOf(contract).id
  const chain = new Set(
    state.contracts.filter((item) => rootOf(item).id === root).map((item) => item.id),
  )
  const linked = new Set(
    state.contracts.filter((item) => chain.has(item.id)).flatMap((item) => item.invoiceIds ?? []),
  )
  return state.invoices
    .filter(
      (invoice) =>
        (invoice.contractId !== undefined && chain.has(invoice.contractId)) ||
        linked.has(invoice.id),
    )
    .reduce((highest, invoice) => Math.max(highest, invoice.installment), 0)
}

/**
 * Kesmeyi ya da iptali yazar. Yeni burs payı taksitleri sözleşmeye bağlı öğrenim taksitidir
 * (`contractId`, `invoiceIds`); geri isteme alacağı (anapara ve faiz) sözleşmeye bağlanmaz, ayrılış
 * hesabı onu iptal etmez (K-266). Önizlemedeki toplam değiştiyse 409 `scholarship_end_changed`.
 * Hata olursa State değişmez.
 */
export function endScholarship(
  state: State,
  award: ScholarshipEndAward,
  kind: ScholarshipEndKind,
  input: unknown,
  context: {
    now: string
    makeId: MakeId
    prior: readonly PriorScholarshipEnd[]
    institutionType?: InstitutionType | undefined
  },
): ScholarshipEndResult {
  const data =
    kind === 'terminate'
      ? terminateScholarshipSchema.parse(input)
      : { ...revokeScholarshipSchema.parse(input), reason: 'false_declaration' as const }
  const quote = quoteScholarshipEnd(
    state,
    award,
    kind === 'terminate' && 'effectiveDate' in data
      ? { kind, effectiveDate: data.effectiveDate }
      : { kind: 'revoke' },
    context,
  )
  if (quote.totalCents !== data.confirmedCents)
    throw conflict(
      'scholarship_end_changed',
      'Hesap önizlemeden sonra değişti; önizlemeyi yenileyip yeniden onaylayın.',
    )
  const contract = awardContract(state, award)
  const base = {
    studentId: award.studentId,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
    academicYear: award.academicYear,
  }
  let installment = chainHighestInstallment(state, contract)
  const reinstated = quote.reinstated.map((line) => ({
    ...base,
    id: context.makeId('inv'),
    installment: ++installment,
    amount: line.amountCents,
    dueDate: `${line.dueDate}${DAY_TIME}`,
    contractId: contract.id,
  }))
  // Geri isteme alacağı sözleşme dışıdır; numara öğrencinin o yılki taksitlerinden devam eder.
  let standalone = state.invoices
    .filter((invoice) => invoice.studentId === award.studentId)
    .reduce((highest, invoice) => Math.max(highest, invoice.installment), installment)
  const clawback =
    quote.clawbackDueDate === null
      ? []
      : [quote.principalCents, quote.interestCents]
          .filter((amount) => amount > 0)
          .map((amount) => ({
            ...base,
            id: context.makeId('inv'),
            installment: ++standalone,
            amount,
            dueDate: `${quote.clawbackDueDate ?? quote.effectiveDate}${DAY_TIME}`,
          }))
  state.invoices.push(...reinstated, ...clawback)
  if (contract.invoiceIds !== undefined)
    contract.invoiceIds = [...contract.invoiceIds, ...reinstated.map((invoice) => invoice.id)]
  return {
    quote,
    reason: data.reason,
    note: data.note,
    invoiceIds: [...reinstated, ...clawback].map((invoice) => invoice.id),
  }
}

const day = (value: string) => dateLabel(`${value}${DAY_TIME}`, { year: 'numeric', month: 'long' })

/**
 * Veliye (yetişkin kursiyerde kendisine) verilen bilgi metni; önizlemede ve geri isteme yazısında
 * aynı paragraflar kullanılır. Gerekçe açıklaması metne girmez, yalnız neden etiketi yazılır.
 */
export function scholarshipEndNotice(
  quote: Pick<
    ScholarshipEndQuote,
    | 'kind'
    | 'effectiveDate'
    | 'reinstated'
    | 'reinstatedCents'
    | 'principalCents'
    | 'interestCents'
    | 'clawbackDueDate'
  >,
  context: {
    programName: string
    studentName: string
    reason: ScholarshipEndReason
    institutionType?: InstitutionType
  },
): string[] {
  const learner = learnerWords(context.institutionType).genitive
  const future =
    quote.reinstatedCents > 0
      ? `${day(quote.effectiveDate)} sonrasında vadesi gelen taksitlerde burs payı kalkmıştır; bu pay ${String(quote.reinstated.length)} ek taksit olarak, toplam ${money(quote.reinstatedCents)}, mevcut vadelerde ödenecektir.`
      : null
  if (quote.kind === 'terminate')
    return [
      `${context.studentName} adlı ${learner} "${context.programName}" bursu ${SCHOLARSHIP_END_REASON_LABELS[context.reason].toLocaleLowerCase('tr')} gerekçesiyle ${day(quote.effectiveDate)} itibarıyla kesilmiştir.`,
      'Kesme gününe kadar uygulanan burs geri istenmez; önceki taksitler değişmez.',
      ...(future === null ? [] : [future]),
    ]
  const clawbackTotal = quote.principalCents + quote.interestCents
  return [
    `${context.studentName} adlı ${learner} "${context.programName}" bursu, başvuruda gerçeğe aykırı beyanda bulunulduğu tespit edildiğinden ${day(quote.effectiveDate)} tarihinde iptal edilmiştir.`,
    ...(clawbackTotal > 0
      ? [
          `Bugüne kadar uygulanan ${money(quote.principalCents)} burs tutarı, her taksitin vade gününden bugüne 3095 sayılı Kanun uyarınca hesaplanan ${money(quote.interestCents)} kanuni faiziyle birlikte, toplam ${money(clawbackTotal)} olarak geri istenmektedir. Son ödeme günü ${day(quote.clawbackDueDate ?? quote.effectiveDate)}.`,
        ]
      : []),
    ...(future === null ? [] : [future]),
  ]
}
