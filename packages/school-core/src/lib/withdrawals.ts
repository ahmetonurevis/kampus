import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isContractInForce } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { packageHourBalance } from './finance-package-hours.ts'
import type { PackageHourKind } from './finance-packages.ts'
import { dayKey, money } from './format.ts'

/**
 * Ayrılış ve iade (docs/domain/finans.md DOM-FIN-040, -041; kayit-ve-crm.md DOM-KAY-024; IST-110;
 * ADR 0006 karar 10). Bütün yürürlükteki sözleşmeler hesaba girer (K-06). Öğretim takvimi kaynağı
 * olmadığı için öğrenim sözleşmesinde görülen ve toplam birim (ders günü veya ders saati) yönetici
 * tarafından girilir; paket satışında kullanılan saat kayıttan gelir (DOM-DIL-051). Yuvarlama ödeyici
 * lehinedir: kesinti aşağı yuvarlanır. Oranlar ve hesap tabanı mevzuat metninde açık değildir,
 * **doğrulanmalı** (DOM-FIN-040).
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

/** Bir sözleşmenin dökümü; toplam döküm bu satırların toplamıdır. */
export interface WithdrawalContractLine {
  contractId: string
  title: string
  /** Paket satışı; öğrenim sözleşmesinde yoktur. */
  packageSaleId?: string
  /** Pakette kullanılan ve satın alınan saat; öğrenim sözleşmesinde girilen birim. */
  attendedUnits: number
  totalUnits: number
  /** Ayrılışla iade edilmiş yazılacak kalan saat (DOM-DIL-051); yalnız pakette. */
  returnedHours?: number
  scholarshipExempt: boolean
  baseCents: number
  deductionCents: number
  usageCents: number
  entitledCents: number
  paidCents: number
  extraBalanceCents: number
  /** Artıysa bu sözleşmeden iade, eksiyse borç; dağıtılmamış tahsilat hariçtir. */
  balanceCents: number
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
  /**
   * Ayrılışta kalan borç için açılan taksit. Yalnız ayrılış kaydında bulunur (önizlemede yok); eski
   * kayıtta yoktur. Bu taksite alınan tahsilat ayrılış hesabının dışındadır ve iptal edilebilir
   * (DOM-FIN-041, `reversePayment`).
   */
  debtInvoiceId?: string
  /**
   * Hesaba giren sözleşmeler, eskiden yeniye (K-06). Üstteki tutarlar bunların toplamıdır. Eski
   * kayıtta yoktur. Kayıt `contract_id`'si yalnız son sözleşmeyi tutar; öteki kimlikler buradadır.
   */
  contracts?: WithdrawalContractLine[]
}

/** Hesaba giren paket satışı ve saat hareketleri (`lesson_package_sales`, DOM-DIL-051). */
export interface WithdrawalPackageSale {
  id: string
  contractId: string
  purchasedHours: number
  entries: readonly { kind: PackageHourKind; hours: number; occurredDate: string }[]
}

export interface WithdrawalContext {
  institutionType: InstitutionType
  /** Taksit → iptal edilmemiş tahsilatlardan dağıtılmış tutar. */
  allocated: ReadonlyMap<string, number>
  /** Taksitlere dağıtılmamış tahsilat tutarı (iade alacağı, DOM-FIN-030). */
  creditCents: number
  /** Öğrencinin paket satışları; dil okulu dışında boştur. */
  packageSales?: readonly WithdrawalPackageSale[]
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

interface AccountContract {
  contract: Contract
  invoices: Invoice[]
  sale: WithdrawalPackageSale | undefined
}

/** Satış ilk sürüme bağlıdır; ek protokol zinciri satışın sözleşmesine kadar geri okunur. */
function saleFinder(state: State, sales: readonly WithdrawalPackageSale[]) {
  const saleByContract = new Map(sales.map((sale) => [sale.contractId, sale]))
  const contractById = new Map(state.contracts.map((item) => [item.id, item]))
  return (contract: Contract) => {
    const seen = new Set<string>()
    let current: Contract | undefined = contract
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      const sale = saleByContract.get(current.id)
      if (sale) return sale
      current = current.amendsContractId ? contractById.get(current.amendsContractId) : undefined
    }
    return undefined
  }
}

/**
 * Hesaba giren sözleşmeler (K-06, DOM-FIN-040), eskiden yeniye; son eleman ayrılış kaydının
 * sözleşmesidir. Onaylanmamış ek protokol ve yerini ek protokole bırakan sürüm girmez (DOM-FIN-012),
 * planlanmış yenileme ayrı iptal yoluyla işlenir. Yeni yıla geçilince geçen yılın öğrenim sözleşmesi
 * yürürlükte görünür ama hizmeti bitmiştir: görülen birim bu yıla aittir, o sözleşmeye uygulanırsa
 * alınmış hizmet iade edilir. Paket satışının saati yıl geçse de yanmadığı için her zaman girer
 * (DOM-DIL-051).
 */
function withdrawalAccount(
  state: State,
  studentId: string,
  sales: readonly WithdrawalPackageSale[],
): AccountContract[] {
  const planned = plannedRenewalContractIds(state, studentId)
  const saleOf = saleFinder(state, sales)
  const inForce = state.contracts.filter(
    (item) =>
      item.studentId === studentId &&
      !planned.has(item.id) &&
      isContractInForce(item, state.contracts),
  )
  const latestYear = Math.max(
    ...inForce.filter((item) => !saleOf(item)).map((item) => item.academicYear ?? 0),
  )
  const contracts = inForce
    .filter((item) => saleOf(item) !== undefined || (item.academicYear ?? 0) === latestYear)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  if (contracts.length === 0)
    throw new DomainError('withdrawal_contract_missing', 'Öğrencinin sözleşmesi bulunamadı.')

  // Taksit bir kez sayılır. Listesi olmayan eski sözleşme yalnız hiçbir sözleşmenin listesinde
  // bulunmayan taksitleri alır; aynı taksit iki sözleşmede görünürse yeni sözleşmede kalır.
  const listed = new Set(
    state.contracts
      .filter((item) => item.studentId === studentId)
      .flatMap((item) => item.invoiceIds ?? []),
  )
  const counted = new Set<string>()
  const newestFirst = [...contracts].reverse().map((contract) => {
    const own = contract.invoiceIds
      ? invoicesOf(state, contract)
      : state.invoices.filter((item) => item.studentId === studentId && !listed.has(item.id))
    const invoices = own.filter((item) => !counted.has(item.id))
    for (const item of invoices) counted.add(item.id)
    return { contract, invoices, sale: saleOf(contract) }
  })
  return newestFirst.reverse()
}

/** Bir sözleşmenin hesabı: öğrenimde girilen birim, pakette kayıtlı saat (DOM-FIN-040, DOM-DIL-051). */
function quoteContract(
  { contract, invoices, sale }: AccountContract,
  data: z.output<typeof withdrawalQuoteSchema>,
  started: boolean,
  allocated: ReadonlyMap<string, number>,
): { line: WithdrawalContractLine; extras: WithdrawalExtraLine[] } {
  // Ayrılıştan sonraki ders kayıtlı olunan süreye girmez (DOM-DIL-051).
  const usedHours = sale?.entries
    .filter((entry) => entry.kind === 'consumed' && entry.occurredDate <= data.withdrawalDate)
    .reduce((sum, entry) => sum + entry.hours, 0)
  const attendedUnits = usedHours ?? data.attendedUnits
  const totalUnits = sale?.purchasedHours ?? data.totalUnits
  const isTuition = (invoice: Invoice) => !invoice.feeKind || invoice.feeKind === 'tuition'
  const share = (amount: number) => Math.floor((amount * attendedUnits) / totalUnits)

  const baseCents = contract.netCents ?? contract.amount
  const deductionCents = data.publicSchoolExemption
    ? 0
    : Math.floor((baseCents * REFUND_DEDUCTION_BASIS_POINTS) / BASIS)
  // Paket saati gerçekleşmiş kayıttır: dönem başlangıcı girdisinden bağımsız kullanılmış sayılır.
  // İndirimli pakette de taban net ücrettir, saat payı net üzerinden işler (H-13, **doğrulanmalı**).
  const usageCents = sale || started ? share(baseCents) : 0
  const paidCents = invoices
    .filter(isTuition)
    .reduce((sum, invoice) => sum + paidOf(invoice, allocated), 0)
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
      paidCents: paidOf(invoice, allocated),
      usedCents: share(invoice.amount),
    }))
  const extraBalanceCents = extras.reduce((sum, line) => sum + line.paidCents - line.usedCents, 0)
  return {
    extras,
    line: {
      contractId: contract.id,
      title: contract.title,
      ...(sale
        ? {
            packageSaleId: sale.id,
            returnedHours: Math.max(
              packageHourBalance(sale.purchasedHours, sale.entries).remainingHours,
              0,
            ),
          }
        : {}),
      attendedUnits,
      totalUnits,
      scholarshipExempt,
      baseCents,
      deductionCents,
      usageCents,
      entitledCents,
      paidCents,
      extraBalanceCents,
      balanceCents: paidCents - entitledCents + extraBalanceCents,
    },
  }
}

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
 * İade hesabı (DOM-FIN-040, K-06): her sözleşme kendi tabanı ve kullanımıyla hesaplanır, toplam döküm
 * satırların toplamıdır. Taban sözleşmenin net ücretidir. Kesinti `taban × %10`, kullanım
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
  const account = withdrawalAccount(state, studentId, context.packageSales ?? [])
  const latest = account.at(-1)
  if (!latest)
    throw new DomainError('withdrawal_contract_missing', 'Öğrencinin sözleşmesi bulunamadı.')
  const quotes = account.map((item) => quoteContract(item, data, started, context.allocated))
  const lines = quotes.map((quote) => quote.line)
  const total = (pick: (line: WithdrawalContractLine) => number) =>
    lines.reduce((sum, line) => sum + pick(line), 0)
  // Sözleşmeler, ek hizmet ve dağıtılmamış tahsilat tek bakiyede netleşir: iade ve borç birlikte
  // oluşmaz (DOM-FIN-040: ödenen hak edilenden azsa iade sıfırdır).
  const balance = total((line) => line.balanceCents) + context.creditCents
  return {
    contractId: latest.contract.id,
    breakdown: {
      institutionType: context.institutionType,
      withdrawalDate: data.withdrawalDate,
      termStartDate: data.termStartDate,
      started,
      attendedUnits: data.attendedUnits,
      totalUnits: data.totalUnits,
      publicSchoolExemption: data.publicSchoolExemption,
      scholarshipExempt: lines.some((line) => line.scholarshipExempt),
      deductionBasisPoints: REFUND_DEDUCTION_BASIS_POINTS,
      baseCents: total((line) => line.baseCents),
      deductionCents: total((line) => line.deductionCents),
      usageCents: total((line) => line.usageCents),
      entitledCents: total((line) => line.entitledCents),
      paidCents: total((line) => line.paidCents),
      creditCents: context.creditCents,
      extras: quotes.flatMap((quote) => quote.extras),
      refundCents: Math.max(balance, 0),
      debtCents: Math.max(-balance, 0),
      contracts: lines,
    },
  }
}

/**
 * Sözleşme sözleşme gösterilecek satırlar: birden çok sözleşmede ve pakette toplam satırı kullanımı
 * anlatamaz (pakette saat kayıttan gelir). Tek öğrenim sözleşmesinde ve eski kayıtta boştur, döküm
 * toplam satırlarıyla okunur.
 */
export function contractLinesToShow<T extends { packageSaleId?: string | undefined }>(
  lines: readonly T[] | undefined,
): readonly T[] {
  if (!lines) return []
  return lines.length > 1 || lines.some((line) => line.packageSaleId !== undefined) ? lines : []
}

/** Bir sözleşmenin ekran ve belge satırları; ikisi aynı dökümü aynı sözlerle gösterir (IST-110). */
export function contractLineRows(
  line: WithdrawalContractLine,
  deductionBasisPoints: number,
): readonly (readonly [string, string])[] {
  const usage = `${String(line.attendedUnits)} / ${String(line.totalUnits)}`
  return [
    ['Hesap tabanı (net ücret)', money(line.baseCents)],
    [`Kesinti (%${String(deductionBasisPoints / 100)})`, money(line.deductionCents)],
    [
      line.packageSaleId === undefined
        ? `Kullanım (${usage})`
        : `Kullanım (${usage} ders saati, kayıttan)`,
      money(line.usageCents),
    ],
    ['Hak edilen', money(line.entitledCents)],
    ...(line.scholarshipExempt
      ? ([['Burslu istisnası', 'Ödenenden fazlası istenmez']] as const)
      : []),
    ['Ödenen öğrenim ücreti', money(line.paidCents)],
    ...(line.extraBalanceCents === 0
      ? []
      : ([['Ek hizmet bakiyesi', money(line.extraBalanceCents)]] as const)),
    ...(line.returnedHours
      ? ([['İade edilen kalan saat', `${String(line.returnedHours)} ders saati`]] as const)
      : []),
    line.balanceCents >= 0
      ? ['Bu sözleşmeden iade', money(line.balanceCents)]
      : ['Bu sözleşmeden borç', money(-line.balanceCents)],
  ]
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
 * Ayrılışı uygular (DOM-FIN-041, DOM-KAY-024): öğrenci pasifleşir, hesaba giren bütün sözleşmelerin
 * açık taksitleri iptal edilir (listeden çıkan kayıt arşivlenir), borç kalırsa tek taksit açılır,
 * ileri tarihli etüt, servis ve kulüp kayıtları sonlanır, planlanmış yenileme iptal edilir. Kalan
 * paket saatinin iade hareketini servis yazar (`returnedHours`). Bütün denetimler yazımdan öncedir.
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
  const account = withdrawalAccount(state, studentId, context.packageSales ?? [])

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

  const paidIn = (invoices: readonly Invoice[]) => invoices.filter((invoice) => invoice.paidAt)
  const kept = paidIn(account.find((item) => item.contract.id === contractId)?.invoices ?? [])
  const cancelled = new Set(
    [...account.flatMap((item) => item.invoices), ...renewalInvoices]
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
  // Borç tek bakiyeden doğar, tek taksittir; ayrılış kaydının sözleşmesine yazılır.
  for (const { contract, invoices } of account)
    contract.invoiceIds = [
      ...paidIn(invoices).map((invoice) => invoice.id),
      ...(debt && contract.id === contractId ? [debt.id] : []),
    ]

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
    breakdown: debt ? { ...breakdown, debtInvoiceId: debt.id } : breakdown,
  }
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr')

/**
 * İade ödemesi (DOM-FIN-041): hesap sahibi ödeyici olmalıdır; ödenen iade değiştirilemez. Saf
 * denetimdir, yazımı servis yapar.
 */
export function planRefundPayment(
  withdrawal: {
    refundCents: number
    refundPaidDate: string | null
    payerName: string
    /** Hesaba giren öteki sözleşmelerin ödeyicileri (K-06). */
    otherPayerNames?: readonly string[]
  },
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
  const payers = [withdrawal.payerName, ...(withdrawal.otherPayerNames ?? [])]
  if (!payers.some((name) => normalizedName(name) === normalizedName(data.accountHolder)))
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
