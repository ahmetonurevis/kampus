// Paket tanımı ve satışı formlarının saf mantığı (IST-078; DOM-DIL-050, -051; DOM-FIN-013, -021).
// Kural core'dadır: tanım formu gövdesini core şemasıyla doğrular, tutar ₺ girilir ve kuruşa çevrilir.
import { z } from 'zod'
import type { CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_DISCOUNT_KINDS,
  FEE_ITEM_KIND_LABELS,
  FEE_ITEM_KINDS,
  type FeeDiscountKind,
  type FeeItemKind,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  createPackageSchema,
  PACKAGE_KIND_LABELS,
  PACKAGE_KINDS,
  type PackageKind,
  type PackageSaleStatus,
} from '@kampus/school-core/lib/finance-packages.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  installmentOptionLabel,
  offeredInstallmentCounts,
  resolvePaymentTerm,
  type FeePaymentTerm,
} from '@kampus/school-core/lib/payment-terms.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export type PackageFormValues = {
  kind: PackageKind
  name: string
  courseId: string
  level: string
  lessonHours: string
  hourlyAmount: string
  validityDays: string
}

/** Boş metin `null`, öteki metin sayı; sayı olmayan girdi core şemasında alan hatası olur. */
const optionalNumber = (text: string) => (text.trim() === '' ? null : Number(text.trim()))
const optionalText = (text: string) => (text === '' ? null : text)

/** Kur ücretinde saat ve seviye kurdan gelir; kura bağlı pakette seviye yazılmaz (DOM-DIL-006). */
export function packageBody(values: PackageFormValues) {
  const courseId = optionalText(values.courseId)
  return {
    kind: values.kind,
    name: values.name,
    courseId,
    level: courseId === null ? (optionalText(values.level) as CefrLevel | null) : null,
    lessonHours: values.kind === 'course' ? null : optionalNumber(values.lessonHours),
    hourlyCents: values.hourlyAmount.trim() === '' ? null : parseAmountInput(values.hourlyAmount),
    validityDays: optionalNumber(values.validityDays),
  }
}

/** Düzeltmede tür ve kur bağı değişmez; yalnız düzenlenebilir alanlar gider. */
export function packageUpdateBody(values: PackageFormValues) {
  const body = packageBody(values)
  return {
    name: body.name,
    hourlyCents: body.hourlyCents,
    validityDays: body.validityDays,
    ...(body.courseId === null ? { level: body.level } : {}),
    ...(values.kind === 'course' || body.lessonHours === null
      ? {}
      : { lessonHours: body.lessonHours }),
  }
}

const FORM_FIELD_OF: Readonly<Record<string, keyof PackageFormValues>> = {
  kind: 'kind',
  name: 'name',
  courseId: 'courseId',
  level: 'level',
  lessonHours: 'lessonHours',
  hourlyCents: 'hourlyAmount',
  validityDays: 'validityDays',
}

/** Sunucu alanını forma çevirir; karşılığı olmayan hata form düzeyinde gösterilir. */
export const packageFormField = (name: string): keyof PackageFormValues | null =>
  FORM_FIELD_OF[name] ?? null

export const packageFormSchema = z
  .object({
    kind: z.enum(PACKAGE_KINDS, 'Paket türünü seçin.'),
    name: z.string(),
    courseId: z.string(),
    level: z.string(),
    lessonHours: z.string(),
    hourlyAmount: z.string(),
    validityDays: z.string(),
  })
  .superRefine((values, context) => {
    if (values.hourlyAmount.trim() !== '' && parseAmountInput(values.hourlyAmount) === null) {
      context.addIssue({
        code: 'custom',
        path: ['hourlyAmount'],
        message: 'Tutarı 1.234,56 biçiminde girin.',
      })
      return
    }
    const parsed = createPackageSchema.safeParse(packageBody(values))
    if (parsed.success) return
    for (const issue of parsed.error.issues) {
      const field = packageFormField(String(issue.path[0] ?? ''))
      if (field) context.addIssue({ code: 'custom', path: [field], message: issue.message })
    }
  })

/** `GET /finance/packages` satırı; seviye yanıtta metindir, tablo satırı için tür takma adıdır. */
export type PackageRecord = {
  id: string
  kind: PackageKind
  name: string
  courseId: string | null
  level: string | null
  lessonHours: number | null
  hourlyCents: number | null
  validityDays: number | null
  version: number
}

export const packageDefaults = (pkg?: PackageRecord): PackageFormValues => ({
  kind: pkg?.kind ?? 'hours',
  name: pkg?.name ?? '',
  courseId: pkg?.courseId ?? '',
  level: pkg?.level ?? '',
  lessonHours: pkg?.lessonHours == null ? '' : String(pkg.lessonHours),
  hourlyAmount: pkg?.hourlyCents == null ? '' : amountInputValue(pkg.hourlyCents),
  validityDays: pkg?.validityDays == null ? '' : String(pkg.validityDays),
})

export type PackageRow = PackageRecord & {
  kindLabel: string
  courseName: string
  hoursLabel: string
  hourlyLabel: string
  validityLabel: string
}

export function packageRow(
  pkg: PackageRecord,
  courseNames: ReadonlyMap<string, string>,
): PackageRow {
  return {
    ...pkg,
    kindLabel: PACKAGE_KIND_LABELS[pkg.kind],
    courseName: pkg.courseId === null ? '—' : (courseNames.get(pkg.courseId) ?? '—'),
    hoursLabel: pkg.lessonHours === null ? 'Kurdan' : `${String(pkg.lessonHours)} saat`,
    hourlyLabel: pkg.hourlyCents === null ? 'Tarifeden' : money(pkg.hourlyCents),
    validityLabel: pkg.validityDays === null ? 'Süresiz' : `${String(pkg.validityDays)} gün`,
  }
}

export const PACKAGE_SALE_STATUS_VIEW: Readonly<
  Record<PackageSaleStatus, { label: string; tone: BadgeTone }>
> = {
  active: { label: 'Etkin', tone: 'green' },
  expired: { label: 'Süresi doldu', tone: 'amber' },
  depleted: { label: 'Saati bitti', tone: 'gray' },
}

/** Satış formu tarifeden beslenir: yalnız ilan edilen seçenekler sunulur (DOM-FIN-002, -013). */
export type SaleTariff = {
  id: string
  items: readonly { kind: FeeItemKind; amountCents: number; level: string | null }[]
  discounts: readonly { kind: FeeDiscountKind }[]
  paymentTerms?: readonly FeePaymentTerm[]
}

// Paket satışı yalnız dil okulundadır (IST-078); kayıtlı kişi orada kursiyerdir (DOM-KAY-012).
export const saleFormSchema = z.object({
  studentId: z.string().min(1, 'Kursiyer seçin.'),
  packageId: z.string().min(1, 'Paket seçin.'),
  installmentCount: z.string().regex(/^\d{1,2}$/, 'Taksit sayısını seçin.'),
  firstDueDate: daySchema,
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS)),
  extras: z.array(z.enum(FEE_ITEM_KINDS)),
})
export type SaleFormValues = z.infer<typeof saleFormSchema>

export const saleDefaults = (today: string, count: number): SaleFormValues => ({
  studentId: '',
  packageId: '',
  installmentCount: String(count),
  firstDueDate: today,
  discounts: [],
  extras: [],
})

export const installmentOptions = (terms: readonly FeePaymentTerm[] | undefined) =>
  offeredInstallmentCounts(terms).map((count) => ({
    value: String(count),
    label: installmentOptionLabel(count, terms),
  }))

/**
 * Seçilebilir indirimler: peşin indirimi yalnız peşin koşulunda (DOM-FIN-013), personel çocuğu
 * yalnız yöneticide (DOM-FIN-021). Pakette burs seçeneği yoktur (K-19).
 */
export function availableDiscounts(
  tariff: SaleTariff,
  installmentCount: number,
  canApproveCapException: boolean,
): { value: FeeDiscountKind; label: string }[] {
  const terms = tariff.paymentTerms
  const hasTerms = (terms?.length ?? 0) > 0
  const term = offeredInstallmentCounts(terms).includes(installmentCount)
    ? resolvePaymentTerm(terms, installmentCount)
    : null
  return tariff.discounts
    .filter(({ kind }) => {
      if (kind === 'referral') return false
      if (kind === 'staff_child') return canApproveCapException
      if (kind === 'early_payment' && hasTerms) return term?.kind === 'upfront'
      return true
    })
    .map(({ kind }) => ({ value: kind, label: FEE_DISCOUNT_KIND_LABELS[kind] }))
}

/** Ek kalemler ayrı borçtur (DOM-FIN-003); tarifedeki öğrenim dışı türler tekilleştirilir. */
export const availableExtras = (tariff: SaleTariff) =>
  [...new Set(tariff.items.map((item) => item.kind))]
    .filter((kind) => kind !== 'tuition')
    .map((kind) => ({ value: kind, label: FEE_ITEM_KIND_LABELS[kind] }))

/**
 * Önizleme gövdesi. Taksit sayısı değişince seçeneği kalkan indirim gönderilmez; form değeri
 * korunur, kullanıcı sayıyı geri alırsa işaret döner.
 */
export function saleQuoteBody(values: SaleFormValues, allowedDiscounts: readonly string[]) {
  return {
    packageId: values.packageId,
    studentId: values.studentId,
    installmentCount: Number(values.installmentCount),
    discounts: values.discounts.filter((kind) => allowedDiscounts.includes(kind)),
    extras: values.extras,
  }
}

const SALE_FIELDS = ['studentId', 'packageId', 'installmentCount', 'firstDueDate'] as const
type SaleField = (typeof SALE_FIELDS)[number]

/** Sunucu alanını forma çevirir; indirim ve ek kalem hatası form düzeyinde gösterilir. */
export const saleFormField = (name: string): SaleField | null =>
  SALE_FIELDS.find((field) => field === name) ?? null
