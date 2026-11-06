import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { isContractInForce } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import { installmentDueDate, itemFor, type EnrollmentTariff } from './enrollment.ts'
import { DomainError } from './errors.ts'
import { FEE_ITEM_KIND_LABELS, type FeeItemKind, type FeeUnit } from './fee-tariffs.ts'

/**
 * Ek hizmet aboneliği (docs/domain/finans.md DOM-FIN-002, -003, -004, -040; ON-087): öğrencinin dönem
 * içinde servis, yemek, kulüp gibi hizmete yazılması ve çıkması. Ücret yayımlı tarifeden hesaplanır,
 * öğrenimden ayrı taksit açar. Taksit sözleşmeye eklenmez: onaylı sözleşmenin tutarı ve planı değişmez
 * (DOM-FIN-010), ek protokol yalnız imza ve onaydan sonra taksit doğurur ve öğrenim planı içindir.
 * Abonelik yürürlükteki sözleşmeyi yalnız kaynak olarak gösterir. Kurallar saftır; satırları servis
 * yükler ve yazar.
 */

/** Dönemsel hizmetler; kitap ve kıyafet tek seferlik kalemdir, abonelik açmaz. */
export const STUDENT_SERVICE_KINDS = [
  'transport',
  'meal',
  'breakfast',
  'club',
  'tutoring',
  'dormitory',
] as const satisfies readonly FeeItemKind[]
export type StudentServiceKind = (typeof STUDENT_SERVICE_KINDS)[number]

export const STUDENT_SERVICE_STATUSES = ['active', 'ended'] as const
export type StudentServiceStatus = (typeof STUDENT_SERVICE_STATUSES)[number]
export const STUDENT_SERVICE_STATUS_LABELS: Readonly<Record<StudentServiceStatus, string>> = {
  active: 'Açık',
  ended: 'Sona erdi',
}

/** Bitişin nedeni: velinin talebiyle çıkış ya da ayrılışta kapanış. */
export const STUDENT_SERVICE_END_REASONS = ['request', 'withdrawal'] as const
export type StudentServiceEndReason = (typeof STUDENT_SERVICE_END_REASONS)[number]

const yearSchema = z.number().int().min(2000).max(2100)

const subscribeFields = {
  kind: z.enum(STUDENT_SERVICE_KINDS, 'Ek hizmeti seçin.'),
  academicYear: yearSchema,
  startDate: daySchema,
  /** Aylık kalemde zorunlu: kaç aylık taksit açılacağını belirler. */
  endDate: daySchema.nullable().default(null),
}
export const subscribeStudentServiceSchema = z.strictObject({
  studentId: requiredText.max(200),
  ...subscribeFields,
})
export type SubscribeStudentServiceInput = z.input<typeof subscribeStudentServiceSchema>

export const endStudentServiceSchema = z.strictObject({ endedDate: daySchema })
export type EndStudentServiceInput = z.input<typeof endStudentServiceSchema>

/** Yazılma formu (web): öğrenci bağlamdan gelir, bitiş günü boş metin olabilir. */
export const studentServiceFormSchema = z.object({
  kind: subscribeFields.kind,
  academicYear: yearSchema,
  startDate: daySchema,
  endDate: z.union([daySchema, z.literal('')]),
})
export type StudentServiceFormValues = z.output<typeof studentServiceFormSchema>

export const studentServiceFormToBody = (
  studentId: string,
  values: StudentServiceFormValues,
): SubscribeStudentServiceInput => ({
  studentId,
  kind: values.kind,
  academicYear: values.academicYear,
  startDate: values.startDate,
  endDate: values.endDate === '' ? null : values.endDate,
})

export const studentServiceKindLabel = (kind: StudentServiceKind) => FEE_ITEM_KIND_LABELS[kind]

/** Aboneliğin kuralların okuduğu alanları; `invoiceIds` aboneliğin açtığı taksitlerdir. */
export interface StudentServiceRow {
  id: string
  studentId: string
  kind: StudentServiceKind
  academicYear: number
  startDate: string
  endDate: string | null
  status: StudentServiceStatus
  invoiceIds: readonly string[]
}

export interface StudentServiceSubscribeContext {
  institutionType: InstitutionType
  /** Eğitim yılına esas tarife (DOM-FIN-002, K-11); yayımlı tarife yoksa `null`. */
  tariff: Pick<EnrollmentTariff, 'id' | 'versionNumber' | 'items'> | null
  /** Öğrencinin açık aboneliklerinin türleri; yıldan bağımsızdır (kısmi benzersiz indeksle aynı). */
  openKinds: readonly string[]
  makeId: MakeId
  now: string
}

export interface PlannedStudentService {
  studentId: string
  kind: StudentServiceKind
  academicYear: number
  tariffId: string
  tariffVersion: number
  /** Tarifedeki kalemin düzeyi; bütün düzeylere uygulanan kalemde boş. */
  feeLevel: string | null
  unit: FeeUnit
  /** Kalemin birim ücreti; aylık kalemde bir ayın, ötekilerde tek taksitin tutarı. */
  amountCents: number
  startDate: string
  endDate: string | null
  /** Yürürlükteki sözleşme (varsa); taksit bu sözleşmenin planına girmez. */
  contractId: string | null
  invoiceIds: string[]
}

const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Okulda düzey sınıf derecesi, kursta sınıfın CEFR düzeyidir (kesin kayıtla aynı). */
function levelOf(state: State, classId: string, institutionType: InstitutionType): string {
  const cls = state.classes.find((item) => item.id === classId)
  if (!cls) return ''
  return institutionType === 'school' ? String(cls.grade) : (cls.level ?? '')
}

/** Aylık kalemde başlangıçtan bitişe kadar her ayın vadesi; ötekilerde başlangıçta tek taksit. */
function dueDates(startDate: string, endDate: string | null, unit: FeeUnit): string[] {
  const start = new Date(`${startDate}T09:00:00.000Z`)
  if (unit !== 'month') return [start.toISOString()]
  if (endDate === null)
    throw new DomainError('student_service_end_required', 'Aylık hizmette bitiş günü zorunludur.', {
      path: ['endDate'],
    })
  const days: string[] = []
  for (let index = 0; ; index += 1) {
    const due = installmentDueDate(start, index).toISOString()
    if (due.slice(0, 10) > endDate) return days
    days.push(due)
  }
}

function assertWithinYear(day: string, academicYear: number, path: string, label: string) {
  const year = Number(day.slice(0, 4))
  if (year !== academicYear && year !== academicYear + 1)
    throw new DomainError(
      'student_service_date_outside_year',
      `${label} günü seçilen eğitim yılında olmalıdır.`,
      { path: [path] },
    )
}

/**
 * Aboneliği planlar (DOM-FIN-003): taksitleri State'e ekler, bütün denetimler yazmadan öncedir. Aynı
 * yılın sözleşmesinde aynı kalem varsa borç iki kez açılmasın diye 409. Kısmi dönem için oran kuralı
 * olmadığından (DOM-FIN-040 yalnız ayrılış) tek taksitli kalem tam tutarla yazılır.
 */
export function planStudentServiceSubscribe(
  state: State,
  input: unknown,
  context: StudentServiceSubscribeContext,
): PlannedStudentService {
  const data = subscribeStudentServiceSchema.parse(input)
  const student = state.students.find((item) => item.id === data.studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (!student.isActive)
    throw conflict('student_service_student_inactive', 'Öğrencinin kaydı aktif değil.')
  assertWithinYear(data.startDate, data.academicYear, 'startDate', 'Başlangıç')
  if (data.endDate !== null) {
    assertWithinYear(data.endDate, data.academicYear, 'endDate', 'Bitiş')
    if (data.endDate < data.startDate)
      throw new DomainError(
        'student_service_end_before_start',
        'Bitiş günü başlangıçtan önce olamaz.',
        { path: ['endDate'] },
      )
  }
  if (context.openKinds.includes(data.kind))
    throw conflict('student_service_open', 'Öğrencinin bu hizmette açık aboneliği var.')
  if (context.tariff === null)
    throw new DomainError(
      'tariff_not_published',
      'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
    )
  const yearContracts = state.contracts.filter(
    (item) =>
      item.studentId === student.id &&
      item.academicYear === data.academicYear &&
      item.cancelledAt === undefined,
  )
  if (yearContracts.some((item) => item.extras?.some((extra) => extra.kind === data.kind)))
    throw conflict(
      'student_service_on_contract',
      'Bu hizmet öğrencinin sözleşmesinde zaten var; ayrıca abonelik açılmaz.',
    )
  const item = itemFor(
    context.tariff.items,
    data.kind,
    levelOf(state, student.classId, context.institutionType),
  )
  if (!item)
    throw new DomainError('extra_not_in_tariff', 'Bu ek hizmet tarifede ilan edilmemiş.', {
      path: ['kind'],
    })
  const invoices = dueDates(data.startDate, data.endDate, item.unit).map((dueDate, index) => ({
    id: context.makeId('inv'),
    studentId: student.id,
    installment: index + 1,
    amount: item.amountCents,
    dueDate,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: data.kind,
    academicYear: data.academicYear,
    createdAt: context.now,
    updatedAt: context.now,
  }))
  state.invoices.push(...invoices)
  const contract = yearContracts
    .filter((candidate) => isContractInForce(candidate, state.contracts))
    .reduce<(typeof yearContracts)[number] | undefined>(
      (latest, candidate) =>
        latest === undefined || Date.parse(candidate.date) >= Date.parse(latest.date)
          ? candidate
          : latest,
      undefined,
    )
  return {
    studentId: student.id,
    kind: data.kind,
    academicYear: data.academicYear,
    tariffId: context.tariff.id,
    tariffVersion: context.tariff.versionNumber,
    feeLevel: item.level,
    unit: item.unit,
    amountCents: item.amountCents,
    startDate: data.startDate,
    endDate: data.endDate,
    contractId: contract?.id ?? null,
    invoiceIds: invoices.map((invoice) => invoice.id),
  }
}

export interface StudentServiceClosure {
  serviceId: string
  endedDate: string
  cancelledInvoiceIds: string[]
}

/**
 * Çıkış gününden sonra vadeli, hiç tahsilat görmemiş taksitleri kaldırır (çalıştırıcı arşivler).
 * Ödenmiş ya da kısmen ödenmiş taksite dokunulmaz; kullanılmamış dönemin iadesi için ek hizmette
 * kesin kural yoktur (DOM-FIN-040, H-15 doğrulanmalı), otomatik iade yazılmaz.
 */
function cancelFutureInvoices(
  state: State,
  service: Pick<StudentServiceRow, 'invoiceIds'>,
  exitDate: string,
  allocated: ReadonlyMap<string, number>,
): string[] {
  const ids = new Set(service.invoiceIds)
  const cancelled = state.invoices
    .filter(
      (invoice) =>
        ids.has(invoice.id) &&
        !invoice.paidAt &&
        (allocated.get(invoice.id) ?? 0) === 0 &&
        invoice.dueDate.slice(0, 10) > exitDate,
    )
    .map((invoice) => invoice.id)
  const gone = new Set(cancelled)
  state.invoices = state.invoices.filter((invoice) => !gone.has(invoice.id))
  return cancelled
}

/** Dönem içi çıkış (DOM-FIN-003): açık abonelik kapanır, ileri vadeli ödenmemiş taksit iptal edilir. */
export function planStudentServiceEnd(
  state: State,
  service: StudentServiceRow,
  input: unknown,
  context: { allocated: ReadonlyMap<string, number>; today: string },
): StudentServiceClosure {
  const { endedDate } = endStudentServiceSchema.parse(input)
  if (service.status !== 'active')
    throw conflict('student_service_ended', 'Bu abonelik zaten sona ermiş.')
  if (endedDate > context.today)
    throw new DomainError('student_service_end_in_future', 'Çıkış günü ileri bir gün olamaz.', {
      path: ['endedDate'],
    })
  if (endedDate < service.startDate)
    throw new DomainError(
      'student_service_end_before_start',
      'Çıkış günü başlangıçtan önce olamaz.',
      { path: ['endedDate'] },
    )
  return {
    serviceId: service.id,
    endedDate,
    cancelledInvoiceIds: cancelFutureInvoices(state, service, endedDate, context.allocated),
  }
}

/**
 * Ayrılışta açık abonelikler kapanır (DOM-KAY-024, DOM-FIN-041). Başlamadan ayrılan öğrencide kayıt
 * bitişi başlangıca çekilir; taksit iptali gerçek ayrılış gününe göre yapılır.
 */
export function closeStudentServicesOnWithdrawal(
  state: State,
  services: readonly StudentServiceRow[],
  withdrawalDate: string,
  allocated: ReadonlyMap<string, number>,
): StudentServiceClosure[] {
  return services
    .filter((service) => service.status === 'active')
    .map((service) => ({
      serviceId: service.id,
      endedDate: withdrawalDate < service.startDate ? service.startDate : withdrawalDate,
      cancelledInvoiceIds: cancelFutureInvoices(state, service, withdrawalDate, allocated),
    }))
}

/** Yenilemedeki ek hizmet aynı yılın açık aboneliğiyle çakışırsa borç iki kez açılmaz (DOM-FIN-003). */
export function assertExtrasFreeOfServices(
  extras: readonly { kind: string }[],
  openKinds: readonly string[],
): void {
  if (extras.some((extra) => openKinds.includes(extra.kind)))
    throw new DomainError(
      'renewal_extra_has_service',
      'Seçilen ek hizmette bu yıl için açık abonelik var; önce aboneliği kapatın ya da hizmeti plandan çıkarın.',
      { kind: 'conflict', path: ['extras'] },
    )
}

export interface StudentServiceInvoiceLine {
  id: string
  amount: number
  dueDate: string
  paidAt: string | null
  /** Çıkışta iptal edildi (kayıt arşivde). */
  cancelled: boolean
}

export interface StudentServiceBalance {
  billedCents: number
  paidCents: number
  openCents: number
  /** Kullanılmamış dönemin tutarı için kural yok; yönetici karar verir, iade otomatik yazılmaz. */
  refundDecisionRequired: boolean
}

/**
 * Aboneliğin tutar özeti; saklanmaz (kısmi tahsilat ve iptal sonradan değişebilir). Karar yalnız
 * erken biten abonelikte sorulur: aylık kalemde çıkıştan sonrasına ait kalan taksit, tek taksitli
 * kalemde kalan taksitin kendisi kullanılmayan dönemi de kapsar.
 */
export function studentServiceBalance(
  service: {
    status: StudentServiceStatus
    unit: FeeUnit
    endDate: string | null
    endedDate: string | null
  },
  lines: readonly StudentServiceInvoiceLine[],
  allocated: ReadonlyMap<string, number>,
): StudentServiceBalance {
  const live = lines.filter((line) => !line.cancelled)
  const paidOf = (line: StudentServiceInvoiceLine) =>
    line.paidAt ? line.amount : (allocated.get(line.id) ?? 0)
  const billedCents = live.reduce((sum, line) => sum + line.amount, 0)
  const paidCents = live.reduce((sum, line) => sum + paidOf(line), 0)
  const endedDate = service.endedDate
  const endedEarly =
    service.status === 'ended' &&
    endedDate !== null &&
    (service.endDate === null || endedDate < service.endDate)
  return {
    billedCents,
    paidCents,
    openCents: billedCents - paidCents,
    refundDecisionRequired:
      endedEarly &&
      live.some((line) => service.unit !== 'month' || line.dueDate.slice(0, 10) > endedDate),
  }
}
