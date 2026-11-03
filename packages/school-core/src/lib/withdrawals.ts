import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isContractInForce } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Ayrılış ve iade (docs/domain/finans.md DOM-FIN-040, -041; kayit-ve-crm.md DOM-KAY-024; IST-110;
 * ADR 0006 karar 10). Öğretim takvimi kaynağı olmadığı için görülen ve toplam birim (ders günü veya
 * ders saati) yönetici tarafından girilir. Yuvarlama ödeyici lehinedir: kesinti aşağı yuvarlanır.
 * Oranlar ve hesap tabanı mevzuat metninde açık değildir, **doğrulanmalı** (DOM-FIN-040).
 */

/** Kesinti oranı; on binde birlik, %10 (ÖÖKY md. 56/3). Hesap dökümüne kopyalanır. */
export const REFUND_DEDUCTION_BASIS_POINTS = 1_000
const BASIS = 10_000
const DAY_TIME = 'T09:00:00.000Z'

export const WITHDRAWAL_REASONS = [
  'transfer',
  'relocation',
  'health',
  'financial',
  'dissatisfaction',
  'other',
] as const
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number]

const quoteFields = {
  withdrawalDate: daySchema,
  termStartDate: daySchema,
  attendedUnits: z.number().int().min(0).max(100_000),
  totalUnits: z.number().int().min(1).max(100_000),
  /** Sınavla öğrenci alan resmî okulun 9. sınıfına kayıt belgelendi (ÖÖKY md. 56/3-a). */
  publicSchoolExemption: z.boolean().default(false),
}
export const withdrawalQuoteSchema = z.strictObject(quoteFields)
export type WithdrawalQuoteInput = z.input<typeof withdrawalQuoteSchema>

export const withdrawStudentSchema = z.strictObject({
  ...quoteFields,
  reason: z.enum(WITHDRAWAL_REASONS, 'Ayrılış nedenini seçin.'),
  targetSchool: requiredText.max(200).nullable().default(null),
})
export type WithdrawStudentInput = z.input<typeof withdrawStudentSchema>

export const WITHDRAWAL_REASON_LABELS: Readonly<Record<WithdrawalReason, string>> = {
  transfer: 'Nakil',
  relocation: 'Taşınma',
  health: 'Sağlık',
  financial: 'Ekonomik',
  dissatisfaction: 'Memnuniyetsizlik',
  other: 'Diğer',
}

/** Ayrılış formu (web): öğrenci seçilir, hedef okul boş metin olabilir. */
export const withdrawalFormSchema = z.object({
  studentId: requiredText,
  withdrawalDate: daySchema,
  termStartDate: daySchema,
  attendedUnits: z.number('Görülen birimi girin.').int().min(0).max(100_000),
  totalUnits: z.number('Toplam birimi girin.').int().min(1).max(100_000),
  publicSchoolExemption: z.boolean(),
  reason: z.enum(WITHDRAWAL_REASONS, 'Ayrılış nedenini seçin.'),
  targetSchool: z.string().trim().max(200),
})
export type WithdrawalFormValues = z.output<typeof withdrawalFormSchema>

/** TR IBAN: 26 karakter, ISO 13616 mod 97 denetimi. */
export function isValidTurkishIban(value: string): boolean {
  if (!/^TR\d{24}$/.test(value)) return false
  const rearranged = value.slice(4) + value.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  let remainder = 0
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1
}

export const payRefundSchema = z.strictObject({
  paidDate: daySchema,
  // kvkk: Ç
  iban: z
    .string()
    .transform((value) => value.replace(/\s/g, '').toUpperCase())
    .refine(isValidTurkishIban, 'Geçerli bir IBAN girin.'),
  // kvkk: K
  accountHolder: requiredText.max(120),
})
export type PayRefundInput = z.input<typeof payRefundSchema>
export type PayRefundOutput = z.output<typeof payRefundSchema>

export interface WithdrawalExtraLine {
  invoiceId: string
  kind: string
  amountCents: number
  paidCents: number
  usedCents: number
}

/** Hesap dökümü: iade kaydında aynen saklanır, sonradan değişmez (DOM-FIN-041). */
export interface WithdrawalBreakdown {
  institutionType: InstitutionType
  withdrawalDate: string
  termStartDate: string
  started: boolean
  attendedUnits: number
  totalUnits: number
  publicSchoolExemption: boolean
  /** Burslu ayrılışı: öğrenim için ödenenden fazlası istenmez (DOM-FIN-025). Eski kayıtta yoktur. */
  scholarshipExempt?: boolean
  deductionBasisPoints: number
  baseCents: number
  deductionCents: number
  usageCents: number
  entitledCents: number
  paidCents: number
  creditCents: number
  extras: WithdrawalExtraLine[]
  refundCents: number
  debtCents: number
}

export interface WithdrawalContext {
  institutionType: InstitutionType
  /** Taksit → iptal edilmemiş tahsilatlardan dağıtılmış tutar. */
  allocated: ReadonlyMap<string, number>
  /** Taksitlere dağıtılmamış tahsilat tutarı (iade alacağı, DOM-FIN-030). */
  creditCents: number
  now: string
}

type Contract = State['contracts'][number]
type Invoice = State['invoices'][number]

function plannedRenewalContractIds(state: State, studentId: string): Set<string> {
  return new Set(
    state.renewals
      .filter((item) => item.studentId === studentId && item.status === 'Planlandı')
      .flatMap((item) => (item.contractId ? [item.contractId] : [])),
  )
}

/** Yürürlükteki sözleşme: planlanmış yenileme dışındaki en yeni sözleşme. */
function currentContract(state: State, studentId: string): Contract {
  const planned = plannedRenewalContractIds(state, studentId)
  // Onaylanmamış ek protokol ve yerini ek protokole bırakan sürüm iadenin tabanı olamaz (DOM-FIN-012).
  const contract = state.contracts
    .filter(
      (item) =>
        item.studentId === studentId &&
        !planned.has(item.id) &&
        isContractInForce(item, state.contracts),
    )
    .reduce<Contract | undefined>(
      (latest, item) =>
        latest === undefined || Date.parse(item.date) >= Date.parse(latest.date) ? item : latest,
      undefined,
    )
  if (!contract)
    throw new DomainError('withdrawal_contract_missing', 'Öğrencinin sözleşmesi bulunamadı.')
  return contract
}

/** Sözleşmenin kendi taksitleri (DOM-FIN-012); alanı olmayan eski kayıtta öğrencinin taksitleri. */
export function invoicesOf(state: State, contract: Contract): Invoice[] {
  return state.invoices.filter((invoice) =>
    contract.invoiceIds
      ? contract.invoiceIds.includes(invoice.id)
      : invoice.studentId === contract.studentId,
  )
}

const paidOf = (invoice: Invoice, allocated: ReadonlyMap<string, number>) =>
  invoice.paidAt ? invoice.amount : (allocated.get(invoice.id) ?? 0)

function assertUnits(data: z.output<typeof withdrawalQuoteSchema>, today: string): boolean {
  if (data.withdrawalDate > today)
    throw new DomainError('withdrawal_date_in_future', 'Ayrılış tarihi ileri bir gün olamaz.', {
      path: ['withdrawalDate'],
    })
  if (data.attendedUnits > data.totalUnits)
    throw new DomainError('attended_exceeds_total', 'Görülen birim toplamı aşamaz.', {
      path: ['attendedUnits'],
    })
  const started = data.withdrawalDate >= data.termStartDate
  if (!started && data.attendedUnits > 0)
    throw new DomainError('attended_before_term', 'Dönem başlamadan görülen birim girilemez.', {
      path: ['attendedUnits'],
    })
  return started
}

function studentOf(state: State, studentId: string) {
  const student = state.students.find((item) => item.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  return student
}

/**
 * İade hesabı (DOM-FIN-040). Taban sözleşmenin net ücretidir. Kesinti `taban × %10`, kullanım
 * `taban × görülen / toplam`; hak edilen tabanı aşamaz. Ek hizmetler ayrı hesaplanır: kullanılmayan
 * süre iade edilir. Saf işlemdir, State değişmez.
 */
export function quoteWithdrawal(
  state: State,
  studentId: string,
  input: unknown,
  context: WithdrawalContext,
): { contractId: string; breakdown: WithdrawalBreakdown } {
  const data = withdrawalQuoteSchema.parse(input)
  studentOf(state, studentId)
  const started = assertUnits(data, dayKey(context.now))
  if (data.publicSchoolExemption && (started || context.institutionType !== 'school'))
    throw new DomainError(
      'exemption_not_applicable',
      'Kesintisiz iade yalnız okulda, öğretim yılı başlamadan uygulanır.',
      { path: ['publicSchoolExemption'] },
    )
  const contract = currentContract(state, studentId)
  const invoices = invoicesOf(state, contract)
  const isTuition = (invoice: Invoice) => !invoice.feeKind || invoice.feeKind === 'tuition'
  const share = (amount: number) => Math.floor((amount * data.attendedUnits) / data.totalUnits)

  const baseCents = contract.netCents ?? contract.amount
  const deductionCents = data.publicSchoolExemption
    ? 0
    : Math.floor((baseCents * REFUND_DEDUCTION_BASIS_POINTS) / BASIS)
  const usageCents = started ? share(baseCents) : 0
  const paidCents = invoices
    .filter(isTuition)
    .reduce((sum, invoice) => sum + paidOf(invoice, context.allocated), 0)
  const scholarshipExempt = contract.scholarship !== undefined
  const computedCents = Math.min(baseCents, deductionCents + usageCents)
  // Burs öğrenim ücretini kapsar: ek hizmetin kullanılan payı bursludan da istenir.
  const entitledCents = scholarshipExempt ? Math.min(computedCents, paidCents) : computedCents

  const extras = invoices
    .filter((invoice) => !isTuition(invoice))
    .map((invoice): WithdrawalExtraLine => ({
      invoiceId: invoice.id,
      kind: invoice.feeKind ?? '',
      amountCents: invoice.amount,
      paidCents: paidOf(invoice, context.allocated),
      usedCents: share(invoice.amount),
    }))
  // Öğrenim, ek hizmet ve dağıtılmamış tahsilat tek bakiyede netleşir: iade ve borç birlikte
  // oluşmaz (DOM-FIN-040: ödenen hak edilenden azsa iade sıfırdır).
  const balance =
    paidCents -
    entitledCents +
    extras.reduce((sum, line) => sum + line.paidCents - line.usedCents, 0) +
    context.creditCents
  return {
    contractId: contract.id,
    breakdown: {
      institutionType: context.institutionType,
      withdrawalDate: data.withdrawalDate,
      termStartDate: data.termStartDate,
      started,
      attendedUnits: data.attendedUnits,
      totalUnits: data.totalUnits,
      publicSchoolExemption: data.publicSchoolExemption,
      scholarshipExempt,
      deductionBasisPoints: REFUND_DEDUCTION_BASIS_POINTS,
      baseCents,
      deductionCents,
      usageCents,
      entitledCents,
      paidCents,
      creditCents: context.creditCents,
      extras,
      refundCents: Math.max(balance, 0),
      debtCents: Math.max(-balance, 0),
    },
  }
}

/** Ayrılıştan bir ay sonrası; o gün yoksa ayın son günü (DOM-FIN-040). */
export function refundDueDate(withdrawalDate: string): string {
  const year = Number(withdrawalDate.slice(0, 4))
  const month = Number(withdrawalDate.slice(5, 7))
  const day = Number(withdrawalDate.slice(8, 10))
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

/**
 * Ayrılışı uygular (DOM-FIN-041, DOM-KAY-024): öğrenci pasifleşir, açık taksitler iptal edilir
 * (listeden çıkan kayıt arşivlenir), borç kalırsa tek taksit açılır, ileri tarihli etüt, servis ve
 * kulüp kayıtları sonlanır, planlanmış yenileme iptal edilir. Bütün denetimler yazımdan öncedir.
 */
export function withdrawStudent(
  state: State,
  studentId: string,
  input: unknown,
  makeId: MakeId,
  context: WithdrawalContext,
) {
  const data = withdrawStudentSchema.parse(input)
  const student = studentOf(state, studentId)
  if (!student.isActive)
    throw new DomainError('student_already_withdrawn', 'Bu öğrencinin kaydı zaten pasif.', {
      kind: 'conflict',
    })
  const { contractId, breakdown } = quoteWithdrawal(
    state,
    studentId,
    {
      withdrawalDate: data.withdrawalDate,
      termStartDate: data.termStartDate,
      attendedUnits: data.attendedUnits,
      totalUnits: data.totalUnits,
      publicSchoolExemption: data.publicSchoolExemption,
    },
    context,
  )
  const contract = currentContract(state, studentId)

  const planned = state.renewals.filter(
    (item) => item.studentId === studentId && item.status === 'Planlandı',
  )
  const renewalContracts = state.contracts.filter((item) =>
    planned.some((renewal) => renewal.contractId === item.id),
  )
  const renewalInvoices = renewalContracts.flatMap((item) => invoicesOf(state, item))
  if (renewalInvoices.some((invoice) => paidOf(invoice, context.allocated) > 0))
    throw new DomainError(
      'withdrawal_renewal_paid',
      'Planlanmış yenilemenin tahsilatı var; önce tahsilatı iptal edin.',
      { kind: 'conflict' },
    )

  const kept = invoicesOf(state, contract).filter((invoice) => invoice.paidAt)
  const cancelled = new Set(
    [...invoicesOf(state, contract), ...renewalInvoices]
      .filter((invoice) => !invoice.paidAt)
      .map((invoice) => invoice.id),
  )
  state.invoices = state.invoices.filter((invoice) => !cancelled.has(invoice.id))

  const debt =
    breakdown.debtCents === 0
      ? null
      : {
          id: makeId('inv'),
          studentId,
          installment: kept.reduce((highest, item) => Math.max(highest, item.installment), 0) + 1,
          amount: breakdown.debtCents,
          dueDate: `${data.withdrawalDate}${DAY_TIME}`,
          paidAt: null,
          method: null,
          reminderAt: null,
          feeKind: 'tuition',
          contractId,
        }
  if (debt) state.invoices.push(debt)
  contract.invoiceIds = [...kept.map((invoice) => invoice.id), ...(debt ? [debt.id] : [])]

  for (const renewal of planned) renewal.status = 'İptal'
  student.isActive = false

  const now = context.now
  state.transportAssignments = state.transportAssignments.filter(
    (item) => item.studentId !== studentId,
  )
  state.clubMemberships = state.clubMemberships.filter((item) => item.studentId !== studentId)
  for (const session of state.tutorSessions) {
    if (
      session.status !== 'Planlandı' ||
      Date.parse(session.date) <= Date.parse(now) ||
      !session.studentIds.includes(studentId)
    )
      continue
    session.studentIds = session.studentIds.filter((id) => id !== studentId)
    if (session.studentIds.length === 0)
      Object.assign(session, {
        status: 'İptal',
        cancelReason: 'Öğrenci ayrıldı',
        cancelledAt: now,
        updatedAt: now,
      })
  }
  return {
    studentId,
    contractId,
    reason: data.reason,
    targetSchool: data.targetSchool,
    withdrawalDate: data.withdrawalDate,
    refundDueDate: refundDueDate(data.withdrawalDate),
    breakdown,
  }
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr')

/**
 * İade ödemesi (DOM-FIN-041): hesap sahibi ödeyici olmalıdır; ödenen iade değiştirilemez. Saf
 * denetimdir, yazımı servis yapar.
 */
export function planRefundPayment(
  withdrawal: { refundCents: number; refundPaidDate: string | null; payerName: string },
  input: unknown,
  today: string,
): { paidDate: string; iban: string; accountHolder: string } {
  const data = payRefundSchema.parse(input)
  if (withdrawal.refundCents === 0)
    throw new DomainError('refund_not_due', 'Bu ayrılışta iade tutarı yok.', { kind: 'conflict' })
  if (withdrawal.refundPaidDate !== null)
    throw new DomainError('refund_already_paid', 'Bu iade zaten ödenmiş.', { kind: 'conflict' })
  if (data.paidDate > today)
    throw new DomainError('refund_date_in_future', 'Ödeme tarihi ileri bir gün olamaz.', {
      path: ['paidDate'],
    })
  if (normalizedName(data.accountHolder) !== normalizedName(withdrawal.payerName))
    throw new DomainError(
      'refund_holder_mismatch',
      'Hesap sahibi sözleşmedeki ödeyici olmalıdır.',
      { path: ['accountHolder'] },
    )
  return data
}

/** Sözleşmedeki ödeyicinin adı: veli veya 18 yaş üstü kursiyer (DOM-KAY-012). */
export function payerNameOf(state: State, contractId: string): string {
  const contract = state.contracts.find((item) => item.id === contractId)
  const student = state.students.find((item) => item.id === contract?.studentId)
  if (!contract || !student)
    throw new DomainError('withdrawal_contract_missing', 'Öğrencinin sözleşmesi bulunamadı.')
  if (contract.payer === 'student') return student.name
  return state.parents.find((parent) => parent.id === student.parentId)?.name ?? ''
}
