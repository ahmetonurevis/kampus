import { z } from 'zod'

import {
  attendanceSummary,
  PROGRESSION_OUTCOMES,
  type LessonHourAttendance,
  type ProgressionOutcome,
} from '../cefr/progression.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema, requiredText } from './domain.ts'
import { DomainError } from './errors.ts'
import { assertFinancePeriod, type FinancePeriod } from './finance-export.ts'
import { FEE_ITEM_KIND_LABELS, type FeeItemKind } from './fee-tariffs.ts'

/**
 * Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti (docs/domain/finans.md DOM-FIN-060;
 * dil-okulu.md DOM-DIL-093; IST-089). Yalnız dil okulundadır. Şirket bağı sözleşmenin ödeyicisini
 * değiştirmez (K-45): toplu fatura, bağın günleri içinde vadesi gelen taksitlerden kesilir. Bir
 * taksit en çok bir geçerli toplu faturada yer alır; işveren raporu devam ve kur sonucundan
 * ibarettir. Fonksiyonlar saftır, `today` ve dönem dışarıdan gelir.
 */

/** Kurumsal müşteri, çalışan bağı, toplu fatura ve rapor yönetici ile ön büronundur (K-51). */
export const CORPORATE_ROLES = ['yonetici', 'onburo'] as const
/** Toplu fatura iptali tahsilat iptali gibi yalnız yöneticidedir (DOM-FIN-052, K-51). */
export const CORPORATE_INVOICE_CANCEL_ROLES = ['yonetici'] as const

export const CORPORATE_NAME_MAX = 200
export const CORPORATE_ADDRESS_MAX = 500
export const CORPORATE_CANCEL_REASON_MAX = 500

// --- Vergi kimlik numarası ------------------------------------------------------------------------

const digitsOf = (value: string) => [...value].map(Number)

/** 10 haneli vergi kimlik numarasının (VKN) kontrol hanesi (DOM-FIN-060, DOM-FIN-070). */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false
  const digits = digitsOf(value)
  let sum = 0
  for (let index = 0; index < 9; index += 1) {
    const shifted = ((digits[index] ?? 0) + (9 - index)) % 10
    let weighted = (shifted * 2 ** (9 - index)) % 9
    if (shifted !== 0 && weighted === 0) weighted = 9
    sum += weighted
  }
  return (10 - (sum % 10)) % 10 === digits[9]
}

/** 11 haneli T.C. kimlik numarasının (şahıs şirketi) iki kontrol hanesi. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = digitsOf(value)
  const at = (index: number) => d[index] ?? 0
  const odd = at(0) + at(2) + at(4) + at(6) + at(8)
  const even = at(1) + at(3) + at(5) + at(7)
  const tenth = (((odd * 7 - even) % 10) + 10) % 10
  if (tenth !== at(9)) return false
  return d.slice(0, 10).reduce((total, digit) => total + digit, 0) % 10 === at(10)
}

/** Şirketin vergi numarası: VKN (10 hane) ya da şahıs şirketinde TCKN (11 hane). */
export function isValidTaxNumber(value: string): boolean {
  return value.length === 10 ? isValidVkn(value) : isValidTckn(value)
}

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Şirket unvanını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(CORPORATE_NAME_MAX, `En fazla ${String(CORPORATE_NAME_MAX)} karakter girebilirsiniz.`)
const taxNumberSchema = z
  .string('Vergi numarasını yazın.')
  .trim()
  .regex(/^\d{10,11}$/, 'Vergi numarası 10 haneli VKN ya da 11 haneli TCKN olmalıdır.')
  .refine(isValidTaxNumber, 'Vergi numarası geçersiz; hanelerini kontrol edin.')
const taxOfficeSchema = z
  .string('Vergi dairesini yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(100, 'En fazla 100 karakter girebilirsiniz.')
const addressSchema = z
  .string('Fatura adresini yazın.')
  .trim()
  .min(10, 'Fatura adresini en az 10 karakterle yazın.')
  .max(CORPORATE_ADDRESS_MAX, `En fazla ${String(CORPORATE_ADDRESS_MAX)} karakter girebilirsiniz.`)
const contactNameSchema = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(120, 'En fazla 120 karakter girebilirsiniz.')
  .nullable()
const contactEmailSchema = z.email('Geçerli bir e-posta adresi girin.').max(254).nullable()
const contactPhoneSchema = z
  .string()
  .regex(/^0\d{10}$/, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
  .nullable()

/** Kurumsal müşteri kaydı (DOM-FIN-060). İletişim alanları isteğe bağlıdır; boşsa `null`. */
export const corporateCustomerSchema = z.strictObject({
  name: nameSchema,
  // kvkk: K (şahıs şirketinde TCKN)
  taxNumber: taxNumberSchema,
  taxOffice: taxOfficeSchema,
  billingAddress: addressSchema,
  // kvkk: K
  contactName: contactNameSchema.default(null),
  // kvkk: K
  contactEmail: contactEmailSchema.default(null),
  // kvkk: K
  contactPhone: contactPhoneSchema.default(null),
})
export type CorporateCustomerInput = z.input<typeof corporateCustomerSchema>
export type CorporateCustomerFields = z.output<typeof corporateCustomerSchema>

/** Kısmi düzeltme; kesilmiş toplu fatura kesildiği anın kopyasını taşıdığından değişmez. */
export const updateCorporateCustomerSchema = z
  .strictObject({
    name: nameSchema.optional(),
    taxNumber: taxNumberSchema.optional(),
    taxOffice: taxOfficeSchema.optional(),
    billingAddress: addressSchema.optional(),
    contactName: contactNameSchema.optional(),
    contactEmail: contactEmailSchema.optional(),
    contactPhone: contactPhoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateCorporateCustomerInput = z.input<typeof updateCorporateCustomerSchema>

/** Kursiyeri şirkete bağlar; işveren raporu aydınlatması onaylanmadan bağ kurulmaz (DOM-DIL-093). */
export const linkCorporateEmployeeSchema = z.strictObject({
  studentId: requiredText,
  startsOn: daySchema.describe('Bağın başladığı gün; bu günden sonra vadesi gelen taksit'),
  noticeConfirmed: z.literal(
    true,
    'Kursiyere işveren raporu aydınlatmasının yapıldığını onaylayın.',
  ),
})
export type LinkCorporateEmployeeInput = z.input<typeof linkCorporateEmployeeSchema>

export const endCorporateEmployeeSchema = z.strictObject({
  endsOn: daySchema.describe('Bağın son günü (dahil)'),
})
export type EndCorporateEmployeeInput = z.input<typeof endCorporateEmployeeSchema>

export const corporateInvoiceSchema = z.strictObject({
  customerId: z.uuid('Şirket geçersiz.'),
  from: daySchema.describe('Dönem başlangıcı (dahil), Europe/Istanbul günü'),
  to: daySchema.describe('Dönem bitişi (dahil); dönem en çok bir yıl'),
})
export type CorporateInvoiceInput = z.input<typeof corporateInvoiceSchema>

export const cancelCorporateInvoiceSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(5, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      CORPORATE_CANCEL_REASON_MAX,
      `En fazla ${String(CORPORATE_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelCorporateInvoiceInput = z.input<typeof cancelCorporateInvoiceSchema>

// --- Müşteri -------------------------------------------------------------------------------------

/** Vergi numarası kurumun etkin müşterileri arasında tekildir. */
export function assertTaxNumberFree(taken: boolean): void {
  if (taken)
    throw new DomainError(
      'corporate_tax_number_exists',
      'Bu vergi numarasıyla kayıtlı bir şirket var.',
      { kind: 'conflict', path: ['taxNumber'] },
    )
}

/** Etkin çalışanı olan şirket arşivlenemez; önce bağlar bitirilir. */
export function assertCustomerArchivable(activeEmployees: number): void {
  if (activeEmployees > 0)
    throw new DomainError(
      'corporate_customer_has_employees',
      'Şirkete bağlı kursiyer var; önce bağları bitirin.',
    )
}

// --- Çalışan bağı --------------------------------------------------------------------------------

export interface CorporateLink {
  id: string
  customerId: string
  studentId: string
  startsOn: string
  /** Bağın son günü (dahil); etkin bağda `null`. */
  endsOn: string | null
}

/**
 * Bağ planı. Kursiyerin aynı anda tek etkin şirket bağı olur; yeni bağ önceki bağın bitişinden
 * sonra başlar ki aynı taksit iki şirketin bağına düşmesin. `links` kursiyerin bütün bağlarıdır.
 */
export function planEmployeeLink(
  input: unknown,
  context: { studentExists: boolean; links: readonly CorporateLink[] },
): { studentId: string; startsOn: string } {
  const data = linkCorporateEmployeeSchema.parse(input)
  if (!context.studentExists)
    throw new DomainError('student_not_found', 'Kursiyer bulunamadı.', {
      kind: 'not_found',
      path: ['studentId'],
    })
  if (context.links.some((link) => link.endsOn === null))
    throw new DomainError(
      'corporate_employee_linked',
      'Kursiyer zaten bir şirkete bağlı; önce o bağı bitirin.',
      { kind: 'conflict', path: ['studentId'] },
    )
  const lastEnd = context.links.reduce<string | null>(
    (latest, link) =>
      link.endsOn !== null && (latest === null || link.endsOn > latest) ? link.endsOn : latest,
    null,
  )
  if (lastEnd !== null && data.startsOn <= lastEnd)
    throw new DomainError(
      'corporate_link_overlaps',
      'Yeni bağ önceki şirket bağının bitişinden sonra başlamalıdır.',
      { path: ['startsOn'] },
    )
  return { studentId: data.studentId, startsOn: data.startsOn }
}

/** Bağı bitiş günüyle kapatır; bağ silinmez, geçmiş dönemin faturası için kalır. */
export function planEmployeeEnd(link: CorporateLink, input: unknown): { endsOn: string } {
  const { endsOn } = endCorporateEmployeeSchema.parse(input)
  if (link.endsOn !== null)
    throw new DomainError('corporate_link_ended', 'Bu bağ zaten bitirildi.', { kind: 'conflict' })
  if (endsOn < link.startsOn)
    throw new DomainError(
      'corporate_link_end_before_start',
      'Bitiş günü bağın başlangıcından önce olamaz.',
      { path: ['endsOn'] },
    )
  return { endsOn }
}

/**
 * Bağ verilen günü kapsar mı (iki uç dahil; gün Europe/Istanbul `YYYY-MM-DD`). Başlangıcı ya da
 * bitişi ileri tarihli olabilir: bağın bugün etkinliği `endsOn === null` ile değil bununla bilinir.
 */
export const linkCovers = (link: Pick<CorporateLink, 'startsOn' | 'endsOn'>, day: string) =>
  link.startsOn <= day && (link.endsOn === null || day <= link.endsOn)

// --- Toplu fatura --------------------------------------------------------------------------------

/** Faturalanabilir taksit adayı: iptal edilmemiş (arşivsiz) taksit. Vade `YYYY-MM-DD`'dir. */
export interface CorporateInvoiceCandidate {
  id: string
  studentId: string
  rootContractId: string | null
  installment: number
  feeKind: FeeItemKind | null
  dueDate: string
  amountCents: number
}

/** Geçerli (iptal edilmemiş) bir toplu faturadaki satırın anahtarları. */
export interface BilledInvoiceKey {
  invoiceId: string
  rootContractId: string | null
  installment: number
}

export type BillableLine = CorporateInvoiceCandidate

const chainKey = (rootContractId: string | null, installment: number) =>
  rootContractId === null ? null : `${rootContractId}\u0000${String(installment)}`

/**
 * Dönemde faturalanacak taksitler (DOM-FIN-060): vadesi dönemde ve şirketin bağında olan, hiçbir
 * geçerli toplu faturada yer almayan taksit. Ek protokolle yerine gelen taksit, eski taksiti
 * faturalanmışsa (aynı sözleşme zinciri ve numara) yeniden girmez (K-52). Ödenmiş taksit de girer
 * (K-46), bütün kalem türleri girer (K-47). Sıra: vade, öğrenci, taksit numarası.
 */
export function billableLines(input: {
  links: readonly CorporateLink[]
  invoices: readonly CorporateInvoiceCandidate[]
  billed: readonly BilledInvoiceKey[]
  period: FinancePeriod
}): BillableLine[] {
  const { period } = input
  const billedIds = new Set(input.billed.map((key) => key.invoiceId))
  const billedChains = new Set(
    input.billed.flatMap((key) => {
      const chain = chainKey(key.rootContractId, key.installment)
      return chain === null ? [] : [chain]
    }),
  )
  const linksOf = new Map<string, CorporateLink[]>()
  for (const link of input.links) {
    const list = linksOf.get(link.studentId) ?? []
    list.push(link)
    linksOf.set(link.studentId, list)
  }
  return input.invoices
    .filter((invoice) => {
      if (invoice.dueDate < period.from || invoice.dueDate > period.to) return false
      if (billedIds.has(invoice.id)) return false
      const chain = chainKey(invoice.rootContractId, invoice.installment)
      if (chain !== null && billedChains.has(chain)) return false
      return (linksOf.get(invoice.studentId) ?? []).some((link) =>
        linkCovers(link, invoice.dueDate),
      )
    })
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.studentId.localeCompare(b.studentId) ||
        a.installment - b.installment ||
        a.id.localeCompare(b.id),
    )
}

/** Toplu faturanın toplamı; dönem geçersizse ya da satır yoksa fatura kesilmez. */
export function planCorporateInvoice(input: {
  period: FinancePeriod
  lines: readonly BillableLine[]
}): { totalCents: number; lineCount: number } {
  assertFinancePeriod(input.period)
  if (input.lines.length === 0)
    throw new DomainError('corporate_invoice_empty', 'Bu dönemde faturalanacak taksit yok.', {
      path: ['from'],
    })
  return {
    totalCents: input.lines.reduce((total, line) => total + line.amountCents, 0),
    lineCount: input.lines.length,
  }
}

/** Kurumda takvim yılı içinde ardışık numara; iptal edilen numara boşta kalır (K-53). */
export function corporateInvoiceNumber(year: number, sequence: number): string {
  return `KF-${String(year)}-${String(sequence).padStart(4, '0')}`
}

/** İptal yalnız geçerli faturada; iptal satırları serbest bırakır. */
export function planCorporateInvoiceCancel(
  invoice: { cancelledAt: string | null },
  input: unknown,
): { reason: string } {
  const data = cancelCorporateInvoiceSchema.parse(input)
  if (invoice.cancelledAt !== null)
    throw new DomainError('corporate_invoice_cancelled', 'Bu toplu fatura zaten iptal edildi.', {
      kind: 'conflict',
    })
  return data
}

export const CORPORATE_LINE_STATUSES = ['open', 'partial', 'paid', 'cancelled'] as const
export type CorporateLineStatus = (typeof CORPORATE_LINE_STATUSES)[number]
export const CORPORATE_LINE_STATUS_LABELS: Readonly<Record<CorporateLineStatus, string>> = {
  open: 'Ödenmedi',
  partial: 'Kısmi ödendi',
  paid: 'Ödendi',
  cancelled: 'Taksit iptal ya da değişti',
}

/**
 * Satırın bugünkü ödeme durumu; saklanmaz, taksitten hesaplanır. Arşivlenen taksit (ayrılışta iptal
 * ya da ek protokolle yerine gelen) `cancelled`'dır.
 */
export function corporateLineStatus(invoice: {
  archived: boolean
  paid: boolean
  allocatedCents: number
}): CorporateLineStatus {
  if (invoice.archived) return 'cancelled'
  if (invoice.paid) return 'paid'
  return invoice.allocatedCents > 0 ? 'partial' : 'open'
}

export interface CorporateInvoiceLineView {
  studentName: string | null
  installment: number
  feeKind: FeeItemKind | null
  dueDate: string
  amountCents: number
  status: CorporateLineStatus
}

const INVOICE_COLUMNS = ['Fatura no', 'Kursiyer', 'Taksit', 'Kalem', 'Vade', 'Tutar', 'Durum']

const feeLabel = (kind: FeeItemKind | null) => FEE_ITEM_KIND_LABELS[kind ?? 'tuition']

/** Toplu fatura dökümü CSV'si: satırlar ve son satırda toplam (`;`, ondalık virgül, formül kaçışı). */
export function corporateInvoiceCsv(
  invoice: { number: string; totalCents: number },
  lines: readonly CorporateInvoiceLineView[],
): string {
  const rows = lines.map((line) => [
    csvCell(invoice.number),
    csvCell(line.studentName ?? ''),
    csvCell(line.installment),
    csvCell(feeLabel(line.feeKind)),
    csvCell(line.dueDate),
    csvAmount(line.amountCents),
    csvCell(CORPORATE_LINE_STATUS_LABELS[line.status]),
  ])
  const total = [
    csvCell(invoice.number),
    csvCell('Toplam'),
    csvCell(''),
    csvCell(''),
    csvCell(''),
    csvAmount(invoice.totalCents),
    csvCell(''),
  ]
  return [INVOICE_COLUMNS.map(csvCell), ...rows, total]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}

// --- Katılım özeti -------------------------------------------------------------------------------

export const CORPORATE_ELIGIBILITY_LABELS = {
  eligible: 'Sağlandı',
  ineligible: 'Sağlanamaz',
  pending: 'Sürüyor',
} as const
export type CorporateEligibility = keyof typeof CORPORATE_ELIGIBILITY_LABELS

export const CORPORATE_MEMBER_STATUS_LABELS = {
  active: 'Devam ediyor',
  frozen: 'Donduruldu',
} as const

/** Kur kaydının rapora giren kaynağı; gerekçe, puan ve özür bilgisi buraya hiç gelmez. */
export interface CorporateEnrollmentSource {
  enrollmentId: string
  courseName: string
  level: string
  groupName: string
  memberStatus: keyof typeof CORPORATE_MEMBER_STATUS_LABELS
  totalHours: number
  attendance: readonly LessonHourAttendance[]
  decisions: readonly { outcome: ProgressionOutcome; status: string; decidedAt: string }[]
}

export interface CorporateAttendanceRow {
  enrollmentId: string
  courseName: string
  level: string
  groupName: string
  memberStatus: keyof typeof CORPORATE_MEMBER_STATUS_LABELS
  totalHours: number
  recordedHours: number
  attendedHours: number
  absentHours: number
  /** Katılınan ÷ yoklaması alınan saat, binde, aşağı yuvarlanır; yoklama yoksa `null`. */
  attendanceRatePermille: number | null
  /** Devam şartı (DOM-DIL-060); yoklama verisi okunamazsa `null`. */
  eligibility: CorporateEligibility | null
  /** Onaylanmış en son kur sonu kararı; yoksa `null` (DOM-DIL-070). */
  outcome: ProgressionOutcome | null
  /** Yoklama verisi hesaplanamadı (tanımsız kur saati, yinelenen satır); sayılar sıfırdır. */
  attendanceUnavailable: boolean
}

/**
 * İşverene giden kur kaydı satırı (DOM-DIL-093): yalnız devam saatleri, oran, devam şartı ve onaylı
 * kur sonucu. Bozuk yoklama verisi raporu düşürmez; satır `attendanceUnavailable` olur.
 */
export function corporateAttendanceRow(source: CorporateEnrollmentSource): CorporateAttendanceRow {
  const outcome =
    source.decisions
      .filter((decision) => decision.status === 'approved')
      .reduce<{ outcome: ProgressionOutcome; decidedAt: string } | null>(
        (latest, decision) =>
          latest === null || decision.decidedAt >= latest.decidedAt ? decision : latest,
        null,
      )?.outcome ?? null
  const base = {
    enrollmentId: source.enrollmentId,
    courseName: source.courseName,
    level: source.level,
    groupName: source.groupName,
    memberStatus: source.memberStatus,
    totalHours: source.totalHours,
    outcome,
  }
  try {
    const summary = attendanceSummary({ totalHours: source.totalHours, rows: source.attendance })
    return {
      ...base,
      recordedHours: summary.recordedHours,
      attendedHours: summary.attendedHours,
      absentHours: summary.absentHours,
      attendanceRatePermille:
        summary.recordedHours === 0
          ? null
          : Math.floor((summary.attendedHours * 1000) / summary.recordedHours),
      eligibility: summary.status,
      attendanceUnavailable: false,
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    return {
      ...base,
      recordedHours: 0,
      attendedHours: 0,
      absentHours: 0,
      attendanceRatePermille: null,
      eligibility: null,
      attendanceUnavailable: true,
    }
  }
}

export interface CorporateEmployeeReport {
  studentId: string
  studentName: string | null
  startsOn: string
  enrollments: CorporateAttendanceRow[]
}

export interface CorporateReportTotals {
  employeeCount: number
  enrollmentCount: number
  recordedHours: number
  attendedHours: number
  attendanceRatePermille: number | null
}

/** Rapor toplamı bütün kur kayıtlarının saatlerinden; okunamayan yoklama toplama girmez. */
export function corporateReportTotals(
  employees: readonly CorporateEmployeeReport[],
): CorporateReportTotals {
  const rows = employees.flatMap((employee) => employee.enrollments)
  const recordedHours = rows.reduce((total, row) => total + row.recordedHours, 0)
  const attendedHours = rows.reduce((total, row) => total + row.attendedHours, 0)
  return {
    employeeCount: employees.length,
    enrollmentCount: rows.length,
    recordedHours,
    attendedHours,
    attendanceRatePermille:
      recordedHours === 0 ? null : Math.floor((attendedHours * 1000) / recordedHours),
  }
}

/** Binde oranı yüzde metni (`875` → `87,5`); oran yoksa boş. */
export function permilleLabel(permille: number | null): string {
  if (permille === null) return ''
  return `${String(Math.floor(permille / 10))},${String(permille % 10)}`
}

export const outcomeLabel = (outcome: ProgressionOutcome | null) =>
  outcome === null ? 'Karar yok' : PROGRESSION_OUTCOMES[outcome].label

export const eligibilityLabel = (row: CorporateAttendanceRow) =>
  row.eligibility === null ? 'Hesaplanamadı' : CORPORATE_ELIGIBILITY_LABELS[row.eligibility]

const REPORT_COLUMNS = [
  'Kursiyer',
  'Bağ başlangıcı',
  'Kur',
  'Seviye',
  'Grup',
  'Kur durumu',
  'Toplam saat',
  'Yoklaması alınan saat',
  'Katılınan saat',
  'Gelinmeyen saat',
  'Katılım oranı (%)',
  'Devam şartı',
  'Kur sonucu',
]

/** Katılım özeti CSV'si: kur kaydı başına satır; kaydı olmayan çalışan tek boş satırla görünür. */
export function corporateAttendanceCsv(employees: readonly CorporateEmployeeReport[]): string {
  const rows = employees.flatMap((employee) => {
    const person = [csvCell(employee.studentName ?? ''), csvCell(employee.startsOn)]
    if (employee.enrollments.length === 0)
      return [[...person, ...Array.from({ length: REPORT_COLUMNS.length - 2 }, () => csvCell(''))]]
    return employee.enrollments.map((row) => [
      ...person,
      csvCell(row.courseName),
      csvCell(row.level),
      csvCell(row.groupName),
      csvCell(CORPORATE_MEMBER_STATUS_LABELS[row.memberStatus]),
      csvCell(row.totalHours),
      csvCell(row.recordedHours),
      csvCell(row.attendedHours),
      csvCell(row.absentHours),
      csvCell(permilleLabel(row.attendanceRatePermille)),
      csvCell(eligibilityLabel(row)),
      csvCell(outcomeLabel(row.outcome)),
    ])
  })
  return [REPORT_COLUMNS.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
