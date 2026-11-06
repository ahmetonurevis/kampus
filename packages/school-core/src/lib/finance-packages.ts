import { z } from 'zod'

import { CEFR_LEVELS, type CefrLevel } from '../content/taxonomy.ts'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { addDays } from './academic-years.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import {
  DISCOUNT_CAP_BASIS_POINTS,
  discountLines,
  extraLines,
  isNotGuardian,
  itemFor,
  requireSiblingDiscountEligible,
  type DiscountLine,
  type EnrollmentTariff,
  type ExtraLine,
} from './enrollment.ts'
import { DomainError } from './errors.ts'
import { FEE_DISCOUNT_KINDS, FEE_ITEM_KINDS } from './fee-tariffs.ts'
import { packageHourBalance } from './finance-package-hours.ts'
import { dayKey } from './format.ts'
import {
  assertEarlyPaymentOnUpfront,
  resolvePaymentTerm,
  type ContractPaymentTerm,
} from './payment-terms.ts'
import { installmentAmounts } from './payments.ts'
import { dueDateOf } from './renewals.ts'

/**
 * Dil okulu paket ve ders saati satışı (docs/domain/dil-okulu.md DOM-DIL-006, -050, -051;
 * finans.md DOM-FIN-002, -003, -006, -010, -020…-022; IST-078). Paket fiyat taşımaz, yalnız ilan
 * altı saat ücreti taşıyabilir: fiyat satış anında yayımlı tarifeden hesaplanır, saat ve seviye
 * satış satırına kopyalanır. Saat bakiyesi saklanmaz: satın alınan − tüketilen − iade edilen.
 * Kullanım süresi dolunca saat silinmez (H-19, **doğrulanmalı**); kursiyerin seçimine göre süre
 * uzatılır ya da iade hesabına girer (DOM-FIN-040).
 */

/** Kur ücreti, saat paketi, özel ders paketi (IST-078). */
export const PACKAGE_KINDS = ['course', 'hours', 'private'] as const
export type PackageKind = (typeof PACKAGE_KINDS)[number]

export const PACKAGE_KIND_LABELS: Readonly<Record<PackageKind, string>> = {
  course: 'Kur ücreti',
  hours: 'Saat paketi',
  private: 'Özel ders paketi',
}

/** Satış ve süre uzatma yönetici ile ön büronundur; tanım tarife gibi yöneticidedir (DOM-FIN-052). */
export const PACKAGE_SELL_ROLES = ['yonetici', 'onburo'] as const
/** Satışı öğrenci kendisinde, veli bağlı çocuğunda ve ödeyicisi olduğu öğrencide görür (IST-078). */
export const PACKAGE_SALE_READ_ROLES = ['yonetici', 'onburo', 'veli', 'ogrenci'] as const

export const PACKAGE_NAME_MAX = 120
export const PACKAGE_HOURS_MAX = 2_000
export const PACKAGE_VALIDITY_DAYS_MAX = 1_825
const MAX_MONEY_CENTS = 100_000_000
const BASIS = 10_000

const levelKeys = Object.keys(CEFR_LEVELS) as [CefrLevel, ...CefrLevel[]]
const levelSchema = z.enum(levelKeys, 'Seviyeyi seçin.')
const nameSchema = z
  .string('Paket adını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(PACKAGE_NAME_MAX, `En fazla ${String(PACKAGE_NAME_MAX)} karakter girebilirsiniz.`)
const hoursSchema = z
  .number('Ders saatini girin.')
  .int('Ders saati tam sayı olmalıdır.')
  .min(1, 'Ders saati en az 1 olmalıdır.')
  .max(PACKAGE_HOURS_MAX, `Ders saati en çok ${String(PACKAGE_HOURS_MAX)} olabilir.`)
const hourlySchema = z
  .number('Saat ücretini girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .positive('Tutar sıfırdan büyük olmalıdır.')
  .max(MAX_MONEY_CENTS, 'Tutar en fazla 1.000.000 ₺ olabilir.')
const validitySchema = z
  .number('Kullanım süresini gün olarak girin.')
  .int('Kullanım süresi tam gün olmalıdır.')
  .min(1, 'Kullanım süresi en az 1 gün olmalıdır.')
  .max(PACKAGE_VALIDITY_DAYS_MAX, 'Kullanım süresi en çok 5 yıl olabilir.')

/**
 * Paket tanımı. Kur ücretinde saat ve seviye kurdan gelir (DOM-DIL-006); saat ve özel ders
 * paketinde saat girilir, kur bağı isteğe bağlıdır. `hourlyCents` boşsa satışta tarifenin saat
 * ücreti uygulanır; doluysa ilan altı fiyattır, ilan üstü satışta reddedilir (DOM-DIL-050).
 */
export const createPackageSchema = z
  .strictObject({
    kind: z.enum(PACKAGE_KINDS, 'Paket türünü seçin.'),
    name: nameSchema,
    courseId: z.uuid('Kur geçersiz.').nullable().default(null),
    level: levelSchema.nullable().default(null),
    lessonHours: hoursSchema.nullable().default(null),
    hourlyCents: hourlySchema.nullable().default(null),
    /** Kullanım süresi (gün); boşsa paketin son kullanma tarihi yoktur (DOM-DIL-051). */
    validityDays: validitySchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (value.kind === 'course') {
      if (value.courseId === null) issue('courseId', 'Kur ücreti paketi için kur seçin.')
      if (value.lessonHours !== null)
        issue('lessonHours', 'Kur ücreti paketinde ders saati kurdan gelir.')
    } else if (value.lessonHours === null) issue('lessonHours', 'Ders saatini girin.')
    if (value.courseId !== null && value.level !== null)
      issue('level', 'Kura bağlı pakette seviye kurdan gelir.')
  })
export type CreatePackageInput = z.input<typeof createPackageSchema>

/** Kısmi düzeltme; satılmış paketin satırı kopya olduğundan değişmez. Tür ve kur bağı değişmez. */
export const updatePackageSchema = z
  .strictObject({
    name: nameSchema.optional(),
    level: levelSchema.nullable().optional(),
    lessonHours: hoursSchema.optional(),
    hourlyCents: hourlySchema.nullable().optional(),
    validityDays: validitySchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdatePackageInput = z.input<typeof updatePackageSchema>

const saleFields = {
  packageId: z.uuid('Paket geçersiz.'),
  studentId: requiredText,
  installmentCount: z.number('Taksit sayısını girin.').int().min(1).max(12),
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS, 'İndirim türü geçersiz.')).max(10).default([]),
  /** Kitap, materyal gibi talep edilen ek kalemler; öğrenim ücretine gömülmez (DOM-DIL-050). */
  extras: z.array(z.enum(FEE_ITEM_KINDS, 'Ek hizmet geçersiz.')).max(10).default([]),
}

export const packageQuoteSchema = z.strictObject(saleFields)
export type PackageQuoteInput = z.input<typeof packageQuoteSchema>

export const sellPackageSchema = z.strictObject({
  ...saleFields,
  /** Önizlemenin hesapladığı tarife; yayımdaki sürüm değiştiyse satış yazılmaz. */
  tariffId: requiredText,
  firstDueDate: daySchema,
})
export type SellPackageInput = z.input<typeof sellPackageSchema>

export const extendPackageSaleSchema = z.strictObject({
  expiresDate: daySchema,
  // kvkk: Ç — gerekçe yalnız denetim kaydına yazılır, loglanmaz.
  reason: z
    .string('Uzatma gerekçesini yazın.')
    .trim()
    .min(2, 'Uzatma gerekçesini yazın.')
    .max(500, 'En fazla 500 karakter girebilirsiniz.'),
})
export type ExtendPackageSaleInput = z.input<typeof extendPackageSaleSchema>

export const PACKAGE_HOUR_KINDS = ['consumed', 'refunded'] as const
export type PackageHourKind = (typeof PACKAGE_HOUR_KINDS)[number]
export const PACKAGE_HOUR_SOURCES = ['lesson', 'withdrawal'] as const
export type PackageHourSource = (typeof PACKAGE_HOUR_SOURCES)[number]

/** Saat hareketi: kaynak (ders, ayrılış) başına bir kez yazılır, yoklama yeniden işlenince artmaz. */
export const packageHourEntrySchema = z.strictObject({
  kind: z.enum(PACKAGE_HOUR_KINDS),
  hours: hoursSchema,
  occurredDate: daySchema,
  sourceType: z.enum(PACKAGE_HOUR_SOURCES),
  sourceId: requiredText.max(200),
})
export type PackageHourEntryInput = z.input<typeof packageHourEntrySchema>

export interface LessonPackage {
  id: string
  kind: PackageKind
  name: string
  courseId: string | null
  level: CefrLevel | null
  lessonHours: number | null
  hourlyCents: number | null
  validityDays: number | null
}

/** Kurun paket satışında okunan alanları (DOM-DIL-006). */
export interface PackageCourse {
  id: string
  level: CefrLevel
  totalHours: number
  status: 'draft' | 'active' | 'archived'
}

/** Paket adı tekilliği büyük/küçük harfe duyarsızdır (`lesson_packages.name_key`). */
export const packageNameKey = (value: string) =>
  value.normalize('NFC').trim().toLocaleLowerCase('tr-TR')

function requireNameFree(nameTaken: boolean) {
  if (nameTaken)
    throw new DomainError('package_name_exists', 'Bu adla etkin bir paket var.', {
      kind: 'conflict',
      path: ['name'],
    })
}

/** Yeni paket; kura bağlıysa kur kurumda bulunmalı ve arşivli olmamalıdır. */
export function planPackageCreate(
  input: unknown,
  context: { course: PackageCourse | null; nameTaken: boolean },
) {
  const data = createPackageSchema.parse(input)
  requireNameFree(context.nameTaken)
  if (data.courseId !== null) {
    if (context.course === null)
      throw new DomainError('course_not_found', 'Kur bulunamadı.', { kind: 'not_found' })
    if (context.course.status === 'archived')
      throw new DomainError('package_course_inactive', 'Arşivli kura paket bağlanamaz.', {
        path: ['courseId'],
      })
  }
  return data
}

/** Paket düzeltmesi; yalnız sonraki satışları etkiler (satış satırı kopyadır). */
export function planPackageUpdate(
  current: LessonPackage,
  input: unknown,
  context: { nameTaken: boolean },
) {
  const data = updatePackageSchema.parse(input)
  requireNameFree(context.nameTaken)
  if (data.lessonHours !== undefined && current.kind === 'course')
    throw new DomainError(
      'package_hours_from_course',
      'Kur ücreti paketinde ders saati kurdan gelir.',
      { path: ['lessonHours'] },
    )
  if (data.level !== undefined && data.level !== null && current.courseId !== null)
    throw new DomainError('package_level_from_course', 'Kura bağlı pakette seviye kurdan gelir.', {
      path: ['level'],
    })
  return data
}

export interface PackageSaleContext {
  institutionType: InstitutionType
  /** Etkin (arşivlenmemiş) paket; yoksa `null`. */
  package: LessonPackage | null
  /** Paketin kuru; kura bağlı değilse `null`. */
  course: PackageCourse | null
  tariff: EnrollmentTariff | null
  academicYear: number
  canApproveCapException: boolean
}

export interface PackagePrice {
  packageId: string
  tariffId: string
  tariffVersion: number
  level: CefrLevel | null
  purchasedHours: number
  /** Tarifenin saat ücreti. */
  announcedHourlyCents: number
  /**
   * Satışta uygulanan saat ücreti (DOM-FIN-006). İade payı net ücretten saat oranıyla hesaplanır
   * (`quoteWithdrawal`); indirimsiz satışta bu ücretin kendisidir (H-13, **doğrulanmalı**).
   */
  hourlyCents: number
  /** Saat × tarife saat ücreti. */
  announcedCents: number
  /** Saat × uygulanan saat ücreti. */
  grossCents: number
  discounts: DiscountLine[]
  discountCents: number
  netCents: number
  extras: ExtraLine[]
  installments: number[]
  /** Taksit sayısının ilanlı koşulu (DOM-FIN-013); koşulsuz eski tarifede `null`. */
  paymentTerm: ContractPaymentTerm | null
  /** Son kullanma günü (Europe/Istanbul); süresiz pakette `null`. */
  expiresDate: string | null
}

type PriceInput = z.output<typeof packageQuoteSchema>

function requireSaleable(state: State, data: PriceInput, context: PackageSaleContext) {
  if (context.institutionType !== 'language_school')
    throw new DomainError('package_not_available', 'Paket satışı bu kurum türünde yoktur.', {
      kind: 'not_found',
    })
  if (context.package === null)
    throw new DomainError('package_not_found', 'Paket bulunamadı.', { kind: 'not_found' })
  const student = state.students.find((item) => item.id === data.studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (!student.isActive)
    throw new DomainError('student_inactive', 'Pasif kursiyere paket satılamaz.', {
      path: ['studentId'],
    })
  if (context.package.courseId !== null && context.course?.status !== 'active')
    throw new DomainError('package_course_inactive', 'Paketin kuru etkin değil.', {
      path: ['packageId'],
    })
  if (context.tariff === null)
    throw new DomainError(
      'tariff_not_published',
      'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
    )
  return { pkg: context.package, tariff: context.tariff, student }
}

/**
 * Önizleme ve satışın ortak fiyatı; State değişmez (DOM-DIL-050, DOM-FIN-006). Tarifenin üstünde
 * saat ücreti reddedilir. İndirim ilan ücretinden hesaplanır, zincirlenmez (DOM-FIN-020). İlan altı
 * saat ücreti fiili indirim sayılır ve %50 tavanına girer (DOM-FIN-021; temkinli yorum).
 */
function pricePackage(
  state: State,
  data: PriceInput,
  now: string,
  context: PackageSaleContext,
): { price: PackagePrice; student: State['students'][number]; pkg: LessonPackage } {
  const { pkg, tariff, student } = requireSaleable(state, data, context)
  const course = pkg.courseId === null ? null : context.course
  const level = course?.level ?? pkg.level
  const purchasedHours = pkg.kind === 'course' ? course?.totalHours : pkg.lessonHours
  if (purchasedHours === undefined || purchasedHours === null)
    throw new DomainError('lesson_hours_required', 'Paket ders saatini girin.', {
      path: ['packageId'],
    })
  const tuition = itemFor(tariff.items, 'tuition', level ?? '')
  if (!tuition)
    throw new DomainError('tariff_tuition_missing', 'Tarifede bu düzey için öğrenim ücreti yok.')
  const announcedHourlyCents = tuition.amountCents
  const hourlyCents = pkg.hourlyCents ?? announcedHourlyCents
  if (hourlyCents > announcedHourlyCents)
    throw new DomainError(
      'package_above_tariff',
      'Paketin saat ücreti ilan edilen saat ücretini aşamaz.',
      { path: ['packageId'] },
    )
  const announcedCents = purchasedHours * announcedHourlyCents
  const grossCents = purchasedHours * hourlyCents
  // Taksit sayısı ilanlı koşula bağlanır, koşulun fiyat farkı indirim kalemi olur (DOM-FIN-013).
  const paymentTerm = resolvePaymentTerm(tariff.paymentTerms, data.installmentCount)
  assertEarlyPaymentOnUpfront(paymentTerm, data.discounts)
  // Referans hakkı kesin kayıt ve yenileme sözleşmesinde işaretlenir (DOM-FIN-024); pakette hak seçimi yok.
  if (data.discounts.includes('referral'))
    throw new DomainError(
      'referral_reward_required',
      'Referans indirimi paket satışında kullanılmaz; kesin kayıtta ya da yenilemede referans hakkıyla kullanılır.',
      { path: ['discounts'] },
    )
  const discounts = discountLines(tariff.discounts, announcedCents, data.discounts, {
    canApproveCapException: context.canApproveCapException,
    paymentTerm,
  })
  const discountCents = discounts.reduce((sum, line) => sum + line.amountCents, 0)
  const netCents = grossCents - discountCents
  if (netCents <= 0)
    throw new DomainError('discount_exceeds_gross', 'İndirim öğrenim ücretini karşılayamaz.', {
      path: ['discounts'],
    })
  if (
    !data.discounts.includes('staff_child') &&
    (announcedCents - netCents) * BASIS > announcedCents * DISCOUNT_CAP_BASIS_POINTS
  )
    throw new DomainError(
      'discount_cap_exceeded',
      "İlan altı fiyat ve indirimlerin toplamı ilan ücretinin %50'sini aşamaz.",
      { path: ['discounts'] },
    )
  if (data.discounts.includes('sibling'))
    requireSiblingDiscountEligible(state, {
      studentId: student.id,
      siblingIds: state.students
        .filter((item) => Boolean(student.parentId) && item.parentId === student.parentId)
        .map((item) => item.id),
      tuitionCents: announcedCents,
    })
  return {
    student,
    pkg,
    price: {
      packageId: pkg.id,
      tariffId: tariff.id,
      tariffVersion: tariff.versionNumber,
      level,
      purchasedHours,
      announcedHourlyCents,
      hourlyCents,
      announcedCents,
      grossCents,
      discounts,
      discountCents,
      netCents,
      extras: extraLines(tariff.items, level ?? '', data.extras),
      installments: installmentAmounts(netCents, data.installmentCount),
      paymentTerm,
      expiresDate: pkg.validityDays === null ? null : addDays(dayKey(now), pkg.validityDays),
    },
  }
}

/** Satış formunun ücret özeti; hiçbir kayıt yazılmaz. */
export function quotePackageSale(
  state: State,
  input: unknown,
  now: string,
  context: PackageSaleContext,
): PackagePrice {
  return pricePackage(state, packageQuoteSchema.parse(input), now, context).price
}

/** Satış satırı (`lesson_package_sales`); saat ve seviye kopyadır, kur sonradan değişse de kalır. */
export interface PackageSaleDraft {
  packageId: string
  packageName: string
  kind: PackageKind
  courseId: string | null
  level: CefrLevel | null
  studentId: string
  contractId: string
  tariffId: string
  tariffVersion: number
  purchasedHours: number
  hourlyCents: number
  grossCents: number
  netCents: number
  expiresDate: string | null
  soldAt: string
}

/**
 * Sözleşme ve taksitleri State'e ekler, satış satırını döndürür; servis hepsini tek işlemde yazar.
 * Sözleşme kesin kayıt gibi onay bekler (DOM-FIN-010). Yetişkin kursiyerin ödeyicisi kendisidir
 * (DOM-KAY-012), öteki durumda velidir. Ek kalem ayrı borçtur (DOM-FIN-003). Reddedilen istekte
 * State değişmez: bütün denetimler eklemeden öncedir.
 */
export function sellPackage(
  state: State,
  input: unknown,
  makeId: MakeId,
  now: string,
  context: PackageSaleContext & { approvedByUserId: string },
): PackageSaleDraft {
  const data = sellPackageSchema.parse(input)
  const { tariffId, firstDueDate, ...fields } = data
  const { price, student, pkg } = pricePackage(state, fields, now, context)
  if (tariffId !== price.tariffId)
    throw new DomainError(
      'tariff_changed',
      'Ücret tarifesi değişti. Ödeme planını yeniden kontrol edin.',
      { kind: 'conflict' },
    )
  const parent = state.parents.find((item) => item.id === student.parentId)
  const contractId = makeId('contract')
  const start = new Date(`${firstDueDate}T09:00:00.000Z`)
  const invoice = (line: {
    installment: number
    amount: number
    dueDate: string
    feeKind: string
  }) => ({
    id: makeId('inv'),
    studentId: student.id,
    contractId,
    academicYear: context.academicYear,
    paidAt: null,
    method: null,
    reminderAt: null,
    createdAt: now,
    updatedAt: now,
    ...line,
  })
  const invoices = [
    ...price.installments.map((amount, index) =>
      invoice({
        installment: index + 1,
        amount,
        dueDate: dueDateOf(start, index),
        feeKind: 'tuition',
      }),
    ),
    ...price.extras.map((extra, index) =>
      invoice({
        installment: price.installments.length + index + 1,
        amount: extra.amountCents,
        dueDate: start.toISOString(),
        feeKind: extra.kind,
      }),
    ),
  ]
  state.contracts.push({
    id: contractId,
    studentId: student.id,
    classId: student.classId,
    academicYear: context.academicYear,
    date: now,
    amount: invoices.reduce((sum, item) => sum + item.amount, 0),
    title: `Dil kursu paket sözleşmesi: ${pkg.name}`,
    invoiceIds: invoices.map((item) => item.id),
    tariffId: price.tariffId,
    tariffVersion: price.tariffVersion,
    grossCents: price.grossCents,
    netCents: price.netCents,
    discounts: price.discounts,
    extras: price.extras,
    approvedByUserId: context.approvedByUserId,
    payer: !parent || isNotGuardian(parent) ? 'student' : 'guardian',
    ...(price.paymentTerm === null ? {} : { paymentTerm: price.paymentTerm }),
  })
  state.invoices.push(...invoices)
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    kind: pkg.kind,
    courseId: pkg.courseId,
    level: price.level,
    studentId: student.id,
    contractId,
    tariffId: price.tariffId,
    tariffVersion: price.tariffVersion,
    purchasedHours: price.purchasedHours,
    hourlyCents: price.hourlyCents,
    grossCents: price.grossCents,
    netCents: price.netCents,
    expiresDate: price.expiresDate,
    soldAt: now,
  }
}

// --- Saat bakiyesi (DOM-DIL-051) -----------------------------------------------------------------

export interface PackageHourEntry {
  kind: PackageHourKind
  hours: number
  sourceType: PackageHourSource
  sourceId: string
}

export interface PackageHourBalance {
  purchasedHours: number
  consumedHours: number
  refundedHours: number
  remainingHours: number
}

export { packageHourBalance }

export const PACKAGE_SALE_STATUSES = ['active', 'expired', 'depleted'] as const
export type PackageSaleStatus = (typeof PACKAGE_SALE_STATUSES)[number]

/**
 * Satışın durumu tarihten ve bakiyeden türer, saklanmaz. Süresi dolan pakette kalan saat silinmez:
 * `expired` yalnız yeni tüketimi durdurur, `remainingHours` aynı kalır (DOM-DIL-051, H-19).
 */
export function packageSaleStatus(
  sale: { expiresDate: string | null; remainingHours: number },
  today: string,
): PackageSaleStatus {
  if (sale.remainingHours <= 0) return 'depleted'
  return sale.expiresDate !== null && today > sale.expiresDate ? 'expired' : 'active'
}

/**
 * Saat hareketini denetler (DOM-DIL-051, IST-078: bakiye sıfırın altına inmez). Aynı kaynak ve aynı
 * saat yeniden gelirse `null` döner, hiçbir şey yazılmaz (yoklama yeniden işlenebilir). İade süresi
 * dolan pakette de yazılır; tüketim yazılmaz, önce süre uzatılır.
 */
export function planPackageHourEntry(
  sale: { purchasedHours: number; expiresDate: string | null },
  entries: readonly PackageHourEntry[],
  input: unknown,
  today: string,
) {
  const data = packageHourEntrySchema.parse(input)
  const recorded = entries.find(
    (entry) => entry.sourceType === data.sourceType && entry.sourceId === data.sourceId,
  )
  if (recorded) {
    if (recorded.kind === data.kind && recorded.hours === data.hours) return null
    throw new DomainError(
      'package_hours_source_conflict',
      'Bu kaynak için farklı bir saat hareketi yazılmış.',
      { kind: 'conflict' },
    )
  }
  if (data.occurredDate > today)
    throw new DomainError('package_hours_date_future', 'Saat hareketi gelecek güne yazılamaz.', {
      path: ['occurredDate'],
    })
  if (data.kind === 'consumed' && sale.expiresDate !== null && data.occurredDate > sale.expiresDate)
    throw new DomainError(
      'package_expired',
      'Kullanım süresi dolan pakete ders yazılamaz; süreyi uzatın ya da iade hesabına alın.',
      { path: ['occurredDate'] },
    )
  const { remainingHours } = packageHourBalance(sale.purchasedHours, entries)
  if (data.hours > remainingHours)
    throw new DomainError('package_balance_insufficient', 'Paket saat bakiyesi yetersiz.', {
      path: ['hours'],
    })
  return data
}

/**
 * Süre uzatma (DOM-DIL-051): kursiyerin seçimi, gerekçesiyle. Yeni gün mevcut günden sonra olmalı ve
 * geçmişte olmamalıdır. Süresiz pakette ve saati bitmiş satışta uzatma anlamsızdır.
 */
export function planPackageExtension(
  sale: { expiresDate: string | null; remainingHours: number },
  input: unknown,
  today: string,
) {
  const data = extendPackageSaleSchema.parse(input)
  if (sale.expiresDate === null)
    throw new DomainError('package_no_expiry', 'Bu paketin son kullanma tarihi yok.')
  if (sale.remainingHours <= 0)
    throw new DomainError('package_depleted', 'Saati biten paketin süresi uzatılamaz.')
  if (data.expiresDate <= sale.expiresDate || data.expiresDate < today)
    throw new DomainError(
      'package_extension_not_later',
      'Yeni son kullanma tarihi mevcut tarihten sonra olmalı ve geçmişte olmamalıdır.',
      { path: ['expiresDate'] },
    )
  return data
}
