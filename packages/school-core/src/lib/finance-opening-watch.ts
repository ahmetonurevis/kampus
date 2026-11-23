import { z } from 'zod'

import { isCalendarDay } from './age.ts'
import { contractStatus, type ContractLifecycle } from './contract-status.ts'
import {
  enrollmentEvents,
  type EnrollmentEventKind,
  type EnrollmentRenewal,
  type EnrollmentStudent,
} from './enrollment-status.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Açılış nöbeti (docs/domain/finans.md DOM-FIN-061; ON-095). Yeni öğretim yılı ya da dönem
 * açılırken izlenecek dört bölüm: ilk taksitler, onaylanmamış sözleşmeler, kayıt değişiklikleri
 * (DOM-KAY-026 olayları) ve bekleyen iadeler. Hiçbir şey saklanmaz; her sayı var olan kayıtlardan
 * türetilir. Saf modüldür: API depodan okuduğu satırları verir, `today` Europe/Istanbul günüdür.
 */

z.config(z.locales.tr())

/** Pencere varsayılanı: başlangıçtan 30 gün önce … 41 gün sonra (6 hafta; K-54). */
export const OPENING_WINDOW_DAYS_BEFORE = 30
export const OPENING_WINDOW_DAYS_AFTER = 41
/** Elle verilen pencerenin en uzun hâli (gün, iki uç dahil). */
export const OPENING_WINDOW_MAX_DAYS = 120
/** Vadesi bugünden en çok bu kadar gün sonra olan ilk taksit "yaklaşan" sayılır (K-55). */
export const OPENING_DUE_SOON_DAYS = 7
/** Bölüm başına en çok satır; tamamı mevcut listelerdedir (K-58). */
export const OPENING_WATCH_ROW_LIMIT = 20
/** Eğitim yılı kaydı yoksa yılın başlangıç günü (1 Eylül; `lib/academic-years.ts` varsayılanı). */
export const DEFAULT_YEAR_START = '09-01'

const day = (field: string) =>
  z.string().refine(isCalendarDay, `${field} geçerli bir gün olmalı (YYYY-AA-GG).`)

export const openingWatchQuerySchema = z
  .strictObject({
    academicYear: z.coerce
      .number()
      .int('Eğitim yılı tam sayı olmalı.')
      .min(2000, 'Eğitim yılı en az 2000 olmalı.')
      .max(2100, 'Eğitim yılı en çok 2100 olmalı.')
      .optional()
      .describe('Eğitim yılının başlangıç yılı (2026 → 2026–2027); verilmezse kurumun etkin yılı'),
    termId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Dönem kimliği: pencere dönemin başlangıç gününe göre kurulur'),
    from: day('Başlangıç günü').optional().describe('Pencere başlangıcı (YYYY-MM-DD)'),
    to: day('Bitiş günü').optional().describe('Pencere bitişi (YYYY-MM-DD)'),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Pencerenin başlangıç ve bitiş günü birlikte verilmeli.',
    path: ['to'],
  })
export type OpeningWatchQuery = z.output<typeof openingWatchQuerySchema>

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` güne gün ekler (takvim günü; saat dilimi yok). */
export function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** İki takvim günü arasındaki gün farkı (`to − from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  )
}

/** Gün ya da ISO an → Europe/Istanbul günü. Gün (`YYYY-MM-DD`) olduğu gibi kalır. */
const istanbulDay = (value: string) => (value.length === 10 ? value : dayKey(value))

export interface OpeningTerm {
  id: string
  name: string
  startDate: string
  endDate: string
}

export interface OpeningWindow {
  from: string
  to: string
  /** Pencerenin dayandığı başlangıç günü (yıl ya da dönem); elle verilen pencerede de döner. */
  anchorDate: string
  /** Pencere dönemden kurulduysa dönem kimliği. */
  termId: string | null
}

/**
 * Açılış penceresi (K-54). Elle verilen `from`/`to` önceliklidir; yoksa dönem (verildiyse) ya da
 * yıl başlangıcının 30 gün öncesi ile 41 gün sonrası. Bilinmeyen dönem 422 `opening_term_not_found`,
 * ters pencere 422 `opening_window_invalid`, 120 günü aşan pencere 422 `opening_window_too_long`.
 */
export function openingWindow(input: {
  yearStartDate: string
  terms: readonly OpeningTerm[]
  query: Pick<OpeningWatchQuery, 'termId' | 'from' | 'to'>
}): OpeningWindow {
  const { query } = input
  let anchorDate = input.yearStartDate
  let termId: string | null = null
  if (query.termId !== undefined) {
    const term = input.terms.find((item) => item.id === query.termId)
    if (!term)
      throw new DomainError('opening_term_not_found', 'Seçilen dönem bu eğitim yılında yok.', {
        path: ['termId'],
      })
    anchorDate = term.startDate
    termId = term.id
  }
  if (query.from === undefined || query.to === undefined)
    return {
      from: addDays(anchorDate, -OPENING_WINDOW_DAYS_BEFORE),
      to: addDays(anchorDate, OPENING_WINDOW_DAYS_AFTER),
      anchorDate,
      termId,
    }
  if (query.from > query.to)
    throw new DomainError(
      'opening_window_invalid',
      'Pencerenin başlangıcı bitişinden sonra olamaz.',
      { path: ['from'] },
    )
  if (daysBetween(query.from, query.to) + 1 > OPENING_WINDOW_MAX_DAYS)
    throw new DomainError(
      'opening_window_too_long',
      `Açılış penceresi en çok ${String(OPENING_WINDOW_MAX_DAYS)} gün olabilir.`,
      { path: ['to'] },
    )
  return { from: query.from, to: query.to, anchorDate, termId }
}

// --- Girdi satırları -------------------------------------------------------------------------

export interface OpeningStudent extends EnrollmentStudent {
  // kvkk: K — öğrenci adı
  name: string
}

export interface OpeningClass {
  id: string
  name: string
}

export interface OpeningInvoice {
  id: string
  studentId: string
  installment: number
  amount: number
  dueDate: string
  paidAt?: string | null
  contractId?: string
  academicYear?: number
}

export type OpeningContract = ContractLifecycle & {
  id: string
  studentId: string
  date: string
  academicYear?: number
  invoiceIds?: string[]
}

export interface OpeningWithdrawal {
  id: string
  studentId: string
  withdrawalDate: string
  refundCents: number
  refundDueDate: string
  refundPaidDate: string | null
}

export interface OpeningWatchInput {
  academicYear: number
  today: string
  window: OpeningWindow
  students: readonly OpeningStudent[]
  classes: readonly OpeningClass[]
  invoices: readonly OpeningInvoice[]
  contracts: readonly OpeningContract[]
  /** Taksit kimliği → dağıtılmış tahsilat (kuruş; DOM-FIN-030). */
  allocated: ReadonlyMap<string, number>
  /** Yenileme modülü kapalıysa ya da kurs türündeyse boş verilir. */
  renewals: readonly EnrollmentRenewal[]
  withdrawals: readonly OpeningWithdrawal[]
}

// --- Çıktı ------------------------------------------------------------------------------------

export interface OpeningInstallmentRow {
  invoiceId: string
  // kvkk: K
  studentId: string
  studentName: string
  className: string | null
  contractId: string | null
  installment: number
  dueDate: string
  amountCents: number
  remainingCents: number
  status: 'overdue' | 'due_soon'
  /** Gecikme günü (vadeden sonraki ilk günden; DOM-FIN-034); gecikmemişse 0. */
  overdueDays: number
}

export interface OpeningContractRow {
  contractId: string
  // kvkk: K
  studentId: string
  studentName: string
  className: string | null
  status: 'awaiting_signatory' | 'awaiting_approval'
  revision: number
  contractAt: string
}

export const OPENING_CHANGE_KINDS = [
  'enrolled',
  'renewed',
  'promoted',
  'graduated',
  'withdrawn',
] as const satisfies readonly EnrollmentEventKind[]
export type OpeningChangeKind = (typeof OPENING_CHANGE_KINDS)[number]

export interface OpeningChangeRow {
  kind: OpeningChangeKind
  /** Olay günü (Europe/Istanbul). */
  date: string
  // kvkk: K
  studentId: string
  studentName: string
  fromClassName: string | null
  toClassName: string | null
  /** Ayrılışta: öğrencinin seçilen yıla yenilemesi hiç planlanmamış. */
  withoutRenewal: boolean
}

export interface OpeningRefundRow {
  withdrawalId: string
  // kvkk: K
  studentId: string
  studentName: string
  withdrawalDate: string
  refundCents: number
  refundDueDate: string
  /** Son günden sonraki gün sayısı; süresi geçmemişse 0. */
  overdueDays: number
}

export interface OpeningWatch {
  academicYear: number
  today: string
  from: string
  to: string
  anchorDate: string
  termId: string | null
  firstInstallments: {
    overdueCount: number
    overdueCents: number
    dueSoonCount: number
    dueSoonCents: number
    rows: OpeningInstallmentRow[]
  }
  unapprovedContracts: {
    awaitingSignatoryCount: number
    awaitingApprovalCount: number
    rows: OpeningContractRow[]
  }
  enrollmentChanges: {
    counts: Record<OpeningChangeKind, number>
    withdrawnWithoutRenewal: number
    rows: OpeningChangeRow[]
  }
  refunds: {
    pendingCount: number
    pendingCents: number
    overdueCount: number
    overdueCents: number
    rows: OpeningRefundRow[]
  }
}

const byName = (left: { studentName: string }, right: { studentName: string }) =>
  left.studentName.localeCompare(right.studentName, 'tr')

/** Sözleşme sürümünden zincir köküne (ek protokol `amendsContractId` ile bağlanır). */
function chainRoots(contracts: readonly OpeningContract[]): Map<string, string> {
  const parent = new Map(contracts.map((contract) => [contract.id, contract.amendsContractId]))
  const roots = new Map<string, string>()
  for (const contract of contracts) {
    let id = contract.id
    const seen = new Set<string>()
    for (let next = parent.get(id); next !== undefined && !seen.has(next); next = parent.get(id)) {
      seen.add(id)
      id = next
    }
    roots.set(contract.id, id)
  }
  return roots
}

function firstInstallments(
  input: OpeningWatchInput,
  names: Names,
): OpeningWatch['firstInstallments'] {
  const { academicYear, today, contracts, invoices, allocated } = input
  const byId = new Map(contracts.map((contract) => [contract.id, contract]))
  const roots = chainRoots(contracts)
  // Taksitin sözleşmesi: taksitteki bağ, yoksa sözleşmenin taksit listesi.
  const contractOfInvoice = new Map<string, string>()
  for (const contract of contracts)
    for (const invoiceId of contract.invoiceIds ?? []) contractOfInvoice.set(invoiceId, contract.id)
  const first = new Map<string, OpeningInvoice & { contractId?: string }>()
  for (const invoice of invoices) {
    const contractId = invoice.contractId ?? contractOfInvoice.get(invoice.id)
    const contract = contractId === undefined ? undefined : byId.get(contractId)
    const year = invoice.academicYear ?? contract?.academicYear
    if (year !== academicYear) continue
    const key =
      contractId === undefined
        ? `student:${invoice.studentId}`
        : `contract:${roots.get(contractId) ?? contractId}`
    const current = first.get(key)
    if (current === undefined || invoice.installment < current.installment)
      first.set(key, contractId === undefined ? invoice : { ...invoice, contractId })
  }
  const dueLimit = addDays(today, OPENING_DUE_SOON_DAYS)
  const section: OpeningWatch['firstInstallments'] = {
    overdueCount: 0,
    overdueCents: 0,
    dueSoonCount: 0,
    dueSoonCents: 0,
    rows: [],
  }
  const rows: OpeningInstallmentRow[] = []
  for (const invoice of first.values()) {
    const paid = invoice.paidAt
      ? invoice.amount
      : Math.min(allocated.get(invoice.id) ?? 0, invoice.amount)
    const remainingCents = invoice.amount - paid
    if (remainingCents <= 0) continue
    const due = istanbulDay(invoice.dueDate)
    if (due > dueLimit) continue
    const overdue = due < today
    if (overdue) {
      section.overdueCount += 1
      section.overdueCents += remainingCents
    } else {
      section.dueSoonCount += 1
      section.dueSoonCents += remainingCents
    }
    rows.push({
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      studentName: names.student(invoice.studentId),
      className: names.classOf(invoice.studentId),
      contractId: invoice.contractId ?? null,
      installment: invoice.installment,
      dueDate: due,
      amountCents: invoice.amount,
      remainingCents,
      status: overdue ? 'overdue' : 'due_soon',
      overdueDays: overdue ? daysBetween(due, today) : 0,
    })
  }
  // En eski vade (en uzun gecikme) önce.
  rows.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || byName(left, right))
  section.rows = rows.slice(0, OPENING_WATCH_ROW_LIMIT)
  return section
}

function unapprovedContracts(
  input: OpeningWatchInput,
  names: Names,
  activeIds: ReadonlySet<string>,
): OpeningWatch['unapprovedContracts'] {
  const byStudent = new Map<string, OpeningContract[]>()
  for (const contract of input.contracts) {
    const list = byStudent.get(contract.studentId)
    if (list) list.push(contract)
    else byStudent.set(contract.studentId, [contract])
  }
  const section: OpeningWatch['unapprovedContracts'] = {
    awaitingSignatoryCount: 0,
    awaitingApprovalCount: 0,
    rows: [],
  }
  const rows: OpeningContractRow[] = []
  for (const contract of input.contracts) {
    if (contract.academicYear !== input.academicYear) continue
    if (!activeIds.has(contract.studentId)) continue
    const status = contractStatus(contract, byStudent.get(contract.studentId) ?? [contract])
    if (status !== 'awaiting_signatory' && status !== 'awaiting_approval') continue
    if (status === 'awaiting_signatory') section.awaitingSignatoryCount += 1
    else section.awaitingApprovalCount += 1
    rows.push({
      contractId: contract.id,
      studentId: contract.studentId,
      studentName: names.student(contract.studentId),
      className: names.classOf(contract.studentId),
      status,
      revision: contract.revision ?? 1,
      contractAt: contract.date,
    })
  }
  // En uzun bekleyen önce.
  rows.sort((left, right) => left.contractAt.localeCompare(right.contractAt) || byName(left, right))
  section.rows = rows.slice(0, OPENING_WATCH_ROW_LIMIT)
  return section
}

function groupByStudent<T extends { studentId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(item.studentId)
    if (list) list.push(item)
    else map.set(item.studentId, [item])
  }
  return map
}

/** Olay → satır; sınıf adları kayıtlı sınıflardan, bilinmeyen sınıf `null`. */
function changeRow(
  event: ReturnType<typeof enrollmentEvents>[number],
  context: {
    date: string
    student: OpeningStudent
    studentName: string
    own: readonly EnrollmentRenewal[]
    names: Names
  },
): OpeningChangeRow {
  const { names } = context
  const base = {
    date: context.date,
    studentId: context.student.id,
    studentName: context.studentName,
    withoutRenewal: false,
  }
  switch (event.kind) {
    case 'enrolled':
      return {
        ...base,
        kind: 'enrolled',
        fromClassName: null,
        toClassName: names.className(event.classId),
      }
    case 'renewed': {
      const renewal = context.own.find((item) => item.id === event.renewalId)
      return {
        ...base,
        kind: 'renewed',
        fromClassName: names.className(renewal?.fromClassId),
        toClassName: names.className(event.targetClassId),
      }
    }
    case 'promoted':
      return {
        ...base,
        kind: 'promoted',
        fromClassName: names.className(event.fromClassId),
        toClassName: names.className(event.toClassId),
      }
    case 'graduated':
      return {
        ...base,
        kind: 'graduated',
        fromClassName: names.className(event.fromClassId),
        toClassName: null,
      }
    case 'withdrawn':
      return {
        ...base,
        kind: 'withdrawn',
        fromClassName: names.className(context.student.classId),
        toClassName: null,
        // Ayrılış planlanmış yenilemeyi iptal eder (`İptal`); iptal edilen de "planlanmış"tır.
        withoutRenewal: context.own.every((item) => item.mode !== 'renew'),
      }
    default:
      return event satisfies never
  }
}

function enrollmentChanges(
  input: OpeningWatchInput,
  names: Names,
): OpeningWatch['enrollmentChanges'] {
  const { academicYear, window } = input
  // Yalnız seçilen yılın yenileme kayıtları sayılır; başka yılın geçişi bu açılışa ait değildir.
  const renewals = groupByStudent(input.renewals.filter((item) => item.year === academicYear))
  const withdrawals = groupByStudent(input.withdrawals)
  const counts = Object.fromEntries(OPENING_CHANGE_KINDS.map((kind) => [kind, 0])) as Record<
    OpeningChangeKind,
    number
  >
  let withdrawnWithoutRenewal = 0
  const rows: OpeningChangeRow[] = []
  for (const student of input.students) {
    const own = renewals.get(student.id) ?? []
    const events = enrollmentEvents(student, {
      renewals: own,
      withdrawals: withdrawals.get(student.id) ?? [],
    })
    for (const event of events) {
      if (event.at === null) continue
      const date = istanbulDay(event.at)
      if (date < window.from || date > window.to) continue
      const row = changeRow(event, {
        date,
        student,
        studentName: names.student(student.id),
        own,
        names,
      })
      if (row.withoutRenewal) withdrawnWithoutRenewal += 1
      counts[row.kind] += 1
      rows.push(row)
    }
  }
  // Yeni olay önce.
  rows.sort((left, right) => right.date.localeCompare(left.date) || byName(left, right))
  return { counts, withdrawnWithoutRenewal, rows: rows.slice(0, OPENING_WATCH_ROW_LIMIT) }
}

function refunds(input: OpeningWatchInput, names: Names): OpeningWatch['refunds'] {
  const section: OpeningWatch['refunds'] = {
    pendingCount: 0,
    pendingCents: 0,
    overdueCount: 0,
    overdueCents: 0,
    rows: [],
  }
  const rows: OpeningRefundRow[] = []
  for (const withdrawal of input.withdrawals) {
    if (withdrawal.refundCents <= 0 || withdrawal.refundPaidDate !== null) continue
    section.pendingCount += 1
    section.pendingCents += withdrawal.refundCents
    const overdue = withdrawal.refundDueDate < input.today
    if (overdue) {
      section.overdueCount += 1
      section.overdueCents += withdrawal.refundCents
    }
    rows.push({
      withdrawalId: withdrawal.id,
      studentId: withdrawal.studentId,
      studentName: names.student(withdrawal.studentId),
      withdrawalDate: withdrawal.withdrawalDate,
      refundCents: withdrawal.refundCents,
      refundDueDate: withdrawal.refundDueDate,
      overdueDays: overdue ? daysBetween(withdrawal.refundDueDate, input.today) : 0,
    })
  }
  // Son günü en yakın önce (ayrılış listesiyle aynı sıra).
  rows.sort(
    (left, right) => left.refundDueDate.localeCompare(right.refundDueDate) || byName(left, right),
  )
  section.rows = rows.slice(0, OPENING_WATCH_ROW_LIMIT)
  return section
}

interface Names {
  student: (id: string) => string
  className: (id: string | undefined) => string | null
  classOf: (studentId: string) => string | null
}

function namesOf(input: OpeningWatchInput): Names {
  const students = new Map(input.students.map((student) => [student.id, student]))
  const classes = new Map(input.classes.map((item) => [item.id, item.name]))
  const className = (id: string | undefined) =>
    id === undefined ? null : (classes.get(id) ?? null)
  return {
    student: (id) => students.get(id)?.name ?? '—',
    className,
    classOf: (studentId) => className(students.get(studentId)?.classId),
  }
}

/** Açılış nöbeti (DOM-FIN-061). Girdi değişmez; sonuç her okumada yeniden hesaplanır. */
export function openingWatch(input: OpeningWatchInput): OpeningWatch {
  const names = namesOf(input)
  const activeIds = new Set(
    input.students.filter((student) => student.isActive !== false).map((student) => student.id),
  )
  return {
    academicYear: input.academicYear,
    today: input.today,
    from: input.window.from,
    to: input.window.to,
    anchorDate: input.window.anchorDate,
    termId: input.window.termId,
    firstInstallments: firstInstallments(input, names),
    unapprovedContracts: unapprovedContracts(input, names, activeIds),
    enrollmentChanges: enrollmentChanges(input, names),
    refunds: refunds(input, names),
  }
}

/**
 * Eğitim yılı verilmezse: kurum ayarındaki yıl, yoksa etkin yıl kaydı, o da yoksa bugünün düştüğü
 * yıl (1 Eylül'den önce önceki yıl).
 */
export function defaultOpeningYear(input: {
  settingsYear: number | null
  activeYear: number | null
  today: string
}): number {
  if (input.settingsYear !== null) return input.settingsYear
  if (input.activeYear !== null) return input.activeYear
  const year = Number(input.today.slice(0, 4))
  return input.today.slice(5) >= DEFAULT_YEAR_START ? year : year - 1
}
