import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { csvAmount, csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import {
  EXPORT_DATE_FORMATS,
  EXPORT_DECIMALS,
  EXPORT_SEPARATORS,
  FIXED_COLUMN_SOURCE,
} from './finance-export-profile.ts'
import {
  LESSON_PAY_TYPES,
  PAY_RATE_COMPONENT_LABELS,
  PAY_RATE_COMPONENTS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_TYPES,
  type BenefitForm,
  type LessonPayType,
  type PayRateComponent,
  type PayRateType,
} from './finance-pay-rates.ts'
import { isStaffRole, STAFF_ROLE_LABELS } from './staff-accounts.ts'

/**
 * Bordro programına aktarım (docs/domain/finans.md DOM-FIN-105; ON-202). Kampüs bordro
 * hesaplamaz (ON-193): seçilen ayın **girdi dosyasını** üretir. Kaynak: o ay yürürlükte olan
 * ücret tanımları (DOM-FIN-099) ve ay için elle girilen ek ders saatleri (personel × ay × tür ×
 * saat; ders saati özeti OG-116 gelene kadar).
 *
 * Dosya kalem başına satırdır (K-336): ana ücret ve yan hak tanımı başına bir satır, ek ders
 * saati kaydı başına bir satır. Ay içinde başlayan ya da biten tanımda tutar orantılanmaz;
 * satır ay içindeki başlangıç ve bitiş gününü, gün sayısını ve ayın gün sayısını taşır, tutar
 * sütunu boş kalır. Satırın yönü (`earning` kazanç) avans ve kesintiler (ON-199) için
 * `deduction` kesinti değeriyle genişler; sütun düzeni değişmez. Fonksiyonlar saftır.
 */

/** Ücret verisi yalnız yöneticide (K-306, K-338). */
export const FINANCE_PAYROLL_EXPORT_ROLES = ['yonetici'] as const satisfies readonly Role[]

// --- Ay ------------------------------------------------------------------------------------------

const MONTH_PATTERN = /^20[2-9]\d-(0[1-9]|1[0-2])$/

/** Bordro ayı `YYYY-AA` (2020–2099). */
export const payrollMonthSchema = z
  .string('Ayı seçin.')
  .regex(MONTH_PATTERN, 'Ayı YYYY-AA biçiminde seçin.')
  .describe('Bordro ayı (YYYY-AA, 2020–2099)')

export interface PayrollMonthRange {
  /** Ayın ilk günü (`YYYY-MM-01`). */
  from: string
  /** Ayın son günü. */
  to: string
  /** Ayın takvim günü sayısı. */
  days: number
}

export function payrollMonthRange(month: string): PayrollMonthRange {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number]
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, days }
}

/** İki gün arasındaki takvim günü (ikisi dahil). */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
}

// --- Ek ders saati -------------------------------------------------------------------------------

export const PAYROLL_LESSON_HOURS_MAX = 400
export const PAYROLL_LESSON_NOTE_MAX = 200

const hoursSchema = z
  .number('Saati girin.')
  .int('Saat tam sayı olmalıdır.')
  .min(1, 'Saat en az 1 olmalıdır.')
  .max(PAYROLL_LESSON_HOURS_MAX, `Saat en fazla ${String(PAYROLL_LESSON_HOURS_MAX)} olabilir.`)
  .describe('Ayın toplam saati (tam sayı, 1–400)')
const noteSchema = z
  .string()
  .trim()
  .max(
    PAYROLL_LESSON_NOTE_MAX,
    `En fazla ${String(PAYROLL_LESSON_NOTE_MAX)} karakter girebilirsiniz.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .describe('İsteğe bağlı not, en çok 200 karakter')

/** Ay için elle girilen ek ders saati (K-337): personel × ay × ek ders türü × saat. */
export const payrollLessonHoursInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Personelin kurum üyeliği'),
  month: payrollMonthSchema,
  lessonType: z
    .enum(LESSON_PAY_TYPES, 'Ek ders türünü seçin.')
    .describe('`extra` ek ders (yedek ders dahil), `duty` nöbet'),
  hours: hoursSchema,
  note: noteSchema.default(null),
})
export type PayrollLessonHoursInput = z.input<typeof payrollLessonHoursInputSchema>
export type PayrollLessonHoursFields = z.output<typeof payrollLessonHoursInputSchema>

/** Saat ya da not düzeltmesi; en az bir alan. */
export const payrollLessonHoursUpdateSchema = z
  .strictObject({ hours: hoursSchema.optional(), note: noteSchema.optional() })
  .refine((value) => value.hours !== undefined || value.note !== undefined, {
    message: 'Değiştirilecek saati ya da notu girin.',
    path: ['hours'],
  })
export type PayrollLessonHoursUpdate = z.output<typeof payrollLessonHoursUpdateSchema>

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/**
 * Yeni ek ders saati kaydı (K-337). Personel kurumun yönetici, öğretmen ya da ön büro
 * üyeliğidir; ay içinde ayrılan (pasif) personele de girilir. Gelecek ay girilmez. Aynı
 * personel, ay ve türde tek kayıt olur (409); saat kaydı düzeltilir.
 */
export function planPayrollLessonHours(
  input: PayrollLessonHoursFields,
  checks: { staff: { role: string } | null; exists: boolean; today: string },
): void {
  if (checks.staff === null)
    throw ruleError('payroll_lesson_hours_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'payroll_lesson_hours_not_staff',
      'Ek ders saati yalnız personele (yönetici, öğretmen, ön büro) girilir.',
      'membershipId',
    )
  if (input.month > checks.today.slice(0, 7))
    throw ruleError(
      'payroll_lesson_hours_future_month',
      'Gelecek ayın ek ders saati girilmez.',
      'month',
    )
  if (checks.exists)
    throw new DomainError(
      'payroll_lesson_hours_exist',
      'Bu personelin bu ay ve türde ek ders saati kaydı var; kaydı düzeltin.',
      { kind: 'conflict', path: ['lessonType'] },
    )
}

/** Düzeltme: değişiklik yoksa 422. */
export function planPayrollLessonHoursUpdate(
  current: { hours: number; note: string | null },
  input: PayrollLessonHoursUpdate,
): { hours: number; note: string | null } {
  const next = {
    hours: input.hours ?? current.hours,
    note: input.note === undefined ? current.note : input.note,
  }
  if (next.hours === current.hours && next.note === current.note)
    throw ruleError('payroll_lesson_hours_unchanged', 'Saat ve not değişmedi.', 'hours')
  return next
}

// --- Satırlar ------------------------------------------------------------------------------------

/** Satır yönü: kesinti (`deduction`) avans ve kesintiler (ON-199) için ayrılmıştır. */
export const PAYROLL_LINE_DIRECTIONS = ['earning', 'deduction'] as const
export type PayrollLineDirection = (typeof PAYROLL_LINE_DIRECTIONS)[number]
export const PAYROLL_LINE_DIRECTION_LABELS = {
  earning: 'Kazanç',
  deduction: 'Kesinti',
} as const satisfies Record<PayrollLineDirection, string>

export const PAYROLL_UNITS = ['month', 'hour', 'lesson_hour'] as const
export type PayrollUnit = (typeof PAYROLL_UNITS)[number]
export const PAYROLL_UNIT_LABELS = {
  month: 'Aylık',
  hour: 'Saat',
  lesson_hour: 'Ders saati',
} as const satisfies Record<PayrollUnit, string>

export const PAYROLL_WARNINGS = [
  'partial_month',
  'net_wage',
  'hourly_wage',
  'lesson_rate_missing',
  'lesson_rate_changed',
  'staff_inactive',
] as const
export type PayrollWarning = (typeof PAYROLL_WARNINGS)[number]
export const PAYROLL_WARNING_LABELS = {
  partial_month: 'Ay içinde başladı ya da bitti; tutar gün oranıyla bordroda hesaplanır',
  net_wage: 'Net ücret; brüte çevrilmedi',
  hourly_wage: 'Saat ücreti; çalışılan saat dosyada yok',
  lesson_rate_missing: 'Ek ders ücreti tanımı yok; tutar boş',
  lesson_rate_changed: 'Ay içinde birden çok ek ders ücreti; son tanım kullanıldı',
  staff_inactive: 'Personel pasif (ayrıldı)',
} as const satisfies Record<PayrollWarning, string>

export interface PayrollStaff {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Ayla kesişen, iptal edilmemiş ücret tanımı (DOM-FIN-099). */
export interface PayrollRate {
  id: string
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  amountCents: number
  benefitForm: BenefitForm | null
  taxable: boolean | null
  startDate: string
  endDate: string | null
}

/** Ayın ek ders saati kaydı. */
export interface PayrollLessonHours {
  id: string
  membershipId: string
  lessonType: LessonPayType
  hours: number
  note: string | null
  version: number
}

export interface PayrollExportLine {
  /** Satırın ekrandaki kimliği (tanım ya da saat kaydı). */
  key: string
  month: string
  membershipId: string
  staffName: string
  role: string
  staffActive: boolean
  component: PayRateComponent
  rateType: PayRateType
  /** `<bileşen>.<tür>`, ör. `wage.monthly_gross`; bordro programı kalem koduna eşlenir. */
  itemCode: string
  direction: PayrollLineDirection
  unit: PayrollUnit
  /** Tanımın tutarı (birim ücret); ek ders tanımı yoksa `null`. */
  rateCents: number | null
  /** Ek derste saat; diğerlerinde `null`. */
  quantity: number | null
  /** Tam ay aylık tutar ya da saat × birim ücret; hesaplanamıyorsa `null` (K-336). */
  totalCents: number | null
  taxable: boolean | null
  benefitForm: BenefitForm | null
  /** Tanımın ay içindeki ilk ve son günü (giriş/çıkış); ek derste `null`. */
  startDate: string | null
  endDate: string | null
  /** Ay içinde yürürlükte olduğu takvim günü; ek derste `null`. */
  days: number | null
  monthDays: number
  /** Ek ders saati kaydı (düzeltme ve silme için). */
  lessonHoursId: string | null
  lessonHoursVersion: number | null
  note: string | null
  warnings: PayrollWarning[]
}

export interface PayrollExportTotals {
  lineCount: number
  staffCount: number
  /** Tutarı olan kazanç satırlarının toplamı (kuruş). */
  earningCents: number
  /** Tutarı olan kesinti satırlarının toplamı (kuruş); ON-199 gelene kadar 0. */
  deductionCents: number
  /** Tutarı boş satır (kısmi ay, saat ücreti, ek ders tanımı yok). */
  missingTotalCount: number
}

export interface PayrollExport extends PayrollMonthRange {
  month: string
  lines: PayrollExportLine[]
  totals: PayrollExportTotals
}

const overlaps = (rate: PayrollRate, range: PayrollMonthRange) =>
  rate.startDate <= range.to && (rate.endDate === null || rate.endDate >= range.from)

function wageUnit(rateType: PayRateType): PayrollUnit {
  if (rateType === 'hourly') return 'hour'
  if (rateType === 'lesson_hour') return 'lesson_hour'
  return 'month'
}

const typeOrder = (line: PayrollExportLine) =>
  PAY_RATE_COMPONENTS.indexOf(line.component) * 100 +
  (PAY_RATE_TYPES as readonly string[]).indexOf(line.rateType)

/**
 * Ayın girdi satırları (DOM-FIN-105). Ana ücret ve yan hak: ayla kesişen her tanım bir satırdır;
 * ay içinde başlayan ya da biten tanımın tutarı boş kalır (gün oranı bordroda), saatlik ve ders
 * saati ana ücretinde çalışılan saat bilinmediği için tutar boştur. Ek ders: her saat kaydı bir
 * satırdır; birim ücret o türün ayla kesişen en geç başlayan tanımıdır (K-337). Ek ders ücreti
 * tanımı saat girilmemişse satır üretmez. Sıra: personel adı, bileşen, tür, başlangıç.
 */
export function payrollExportLines(input: {
  month: string
  staff: readonly PayrollStaff[]
  rates: readonly PayrollRate[]
  lessonHours: readonly PayrollLessonHours[]
}): PayrollExport {
  const range = payrollMonthRange(input.month)
  const staffById = new Map(input.staff.map((person) => [person.membershipId, person]))
  const staffOf = (membershipId: string) => {
    const person = staffById.get(membershipId)
    if (person === undefined) throw new Error(`payroll staff missing: ${membershipId}`)
    return person
  }
  const rates = input.rates.filter((rate) => overlaps(rate, range))
  const base = (person: PayrollStaff) => ({
    month: input.month,
    membershipId: person.membershipId,
    staffName: person.name,
    role: person.role,
    staffActive: person.active,
    direction: 'earning' as const,
    monthDays: range.days,
  })
  const lines: PayrollExportLine[] = []

  for (const rate of rates) {
    if (rate.component === 'lesson') continue
    const person = staffOf(rate.membershipId)
    const startDate = rate.startDate > range.from ? rate.startDate : range.from
    const endDate = rate.endDate === null || rate.endDate > range.to ? range.to : rate.endDate
    const partial = startDate !== range.from || endDate !== range.to
    const unit = rate.component === 'wage' ? wageUnit(rate.rateType) : 'month'
    const warnings: PayrollWarning[] = []
    if (partial) warnings.push('partial_month')
    if (rate.rateType === 'monthly_net') warnings.push('net_wage')
    if (unit !== 'month') warnings.push('hourly_wage')
    if (!person.active) warnings.push('staff_inactive')
    lines.push({
      ...base(person),
      key: `rate:${rate.id}`,
      component: rate.component,
      rateType: rate.rateType,
      itemCode: `${rate.component}.${rate.rateType}`,
      unit,
      rateCents: rate.amountCents,
      quantity: null,
      totalCents: unit === 'month' && !partial ? rate.amountCents : null,
      taxable: rate.taxable,
      benefitForm: rate.benefitForm,
      startDate,
      endDate,
      days: daysBetween(startDate, endDate),
      lessonHoursId: null,
      lessonHoursVersion: null,
      note: null,
      warnings,
    })
  }

  for (const entry of input.lessonHours) {
    const person = staffOf(entry.membershipId)
    const candidates = rates.filter(
      (rate) =>
        rate.membershipId === entry.membershipId &&
        rate.component === 'lesson' &&
        rate.rateType === entry.lessonType,
    )
    const chosen = candidates.reduce<PayrollRate | null>(
      (latest, rate) => (latest === null || rate.startDate > latest.startDate ? rate : latest),
      null,
    )
    const warnings: PayrollWarning[] = []
    if (chosen === null) warnings.push('lesson_rate_missing')
    if (candidates.length > 1) warnings.push('lesson_rate_changed')
    if (!person.active) warnings.push('staff_inactive')
    lines.push({
      ...base(person),
      key: `hours:${entry.id}`,
      component: 'lesson',
      rateType: entry.lessonType,
      itemCode: `lesson.${entry.lessonType}`,
      unit: 'hour',
      rateCents: chosen?.amountCents ?? null,
      quantity: entry.hours,
      totalCents: chosen === null ? null : chosen.amountCents * entry.hours,
      taxable: null,
      benefitForm: null,
      startDate: null,
      endDate: null,
      days: null,
      lessonHoursId: entry.id,
      lessonHoursVersion: entry.version,
      note: entry.note,
      warnings,
    })
  }

  lines.sort(
    (a, b) =>
      a.staffName.localeCompare(b.staffName, 'tr') ||
      a.membershipId.localeCompare(b.membershipId) ||
      typeOrder(a) - typeOrder(b) ||
      (a.startDate ?? '').localeCompare(b.startDate ?? ''),
  )
  const signed = (direction: PayrollLineDirection) =>
    lines
      .filter((line) => line.direction === direction)
      .reduce((sum, line) => sum + (line.totalCents ?? 0), 0)
  return {
    month: input.month,
    ...range,
    lines,
    totals: {
      lineCount: lines.length,
      staffCount: new Set(lines.map((line) => line.membershipId)).size,
      earningCents: signed('earning'),
      deductionCents: signed('deduction'),
      missingTotalCount: lines.filter((line) => line.totalCents === null).length,
    },
  }
}

/** Satırın kalem adı: "Ana ücret · Aylık brüt". */
export const payrollItemLabel = (line: Pick<PayrollExportLine, 'component' | 'rateType'>) =>
  `${PAY_RATE_COMPONENT_LABELS[line.component]} · ${PAY_RATE_TYPE_LABELS[line.rateType]}`

const roleText = (role: string) => (isStaffRole(role) ? STAFF_ROLE_LABELS[role] : role)
const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'Evet' : 'Hayır')

// --- Dosya ve sütun eşleme -----------------------------------------------------------------------

type CellKind = 'text' | 'date' | 'amount' | 'integer'
type Source = {
  label: string
  kind: CellKind
  read: (line: PayrollExportLine) => string | number | null
}

const SOURCES = {
  month: { label: 'Dönem', kind: 'text', read: (line) => line.month },
  staffNumber: { label: 'Personel no', kind: 'text', read: (line) => line.membershipId },
  staffName: { label: 'Personel', kind: 'text', read: (line) => line.staffName },
  role: { label: 'Görev', kind: 'text', read: (line) => roleText(line.role) },
  itemCode: { label: 'Kalem kodu', kind: 'text', read: (line) => line.itemCode },
  item: { label: 'Kalem', kind: 'text', read: (line) => payrollItemLabel(line) },
  direction: {
    label: 'Yön',
    kind: 'text',
    read: (line) => PAYROLL_LINE_DIRECTION_LABELS[line.direction],
  },
  unit: { label: 'Birim', kind: 'text', read: (line) => PAYROLL_UNIT_LABELS[line.unit] },
  rate: { label: 'Birim ücret (₺)', kind: 'amount', read: (line) => line.rateCents },
  quantity: { label: 'Miktar', kind: 'integer', read: (line) => line.quantity },
  total: { label: 'Tutar (₺)', kind: 'amount', read: (line) => line.totalCents },
  taxable: { label: 'Vergiye tabi', kind: 'text', read: (line) => yesNo(line.taxable) },
  benefitForm: {
    label: 'Nakdi/ayni',
    kind: 'text',
    read: (line) =>
      line.benefitForm === null ? '' : line.benefitForm === 'cash' ? 'Nakdi' : 'Ayni',
  },
  startDate: { label: 'Başlangıç günü', kind: 'date', read: (line) => line.startDate },
  endDate: { label: 'Bitiş günü', kind: 'date', read: (line) => line.endDate },
  days: { label: 'Gün', kind: 'integer', read: (line) => line.days },
  monthDays: { label: 'Ay gün sayısı', kind: 'integer', read: (line) => line.monthDays },
  warnings: {
    label: 'Uyarı',
    kind: 'text',
    read: (line) => line.warnings.map((code) => PAYROLL_WARNING_LABELS[code]).join('; '),
  },
} as const satisfies Record<string, Source>

/** Seçilebilir sütunlar; sıra genel dosyanın sırasıdır (K-339). */
export const PAYROLL_EXPORT_COLUMN_OPTIONS: readonly { source: string; label: string }[] =
  Object.entries(SOURCES).map(([source, { label }]) => ({ source, label }))

const columnSchema = z.strictObject({
  source: z.string().min(1, 'Sütunu seçin.').describe('Kaynak alan ya da `fixed` sabit değer'),
  header: z
    .string()
    .trim()
    .min(1, 'Sütun başlığını girin.')
    .max(60, 'Sütun başlığı en fazla 60 karakter olabilir.')
    .describe('Dosyadaki sütun adı'),
  value: z
    .string()
    .trim()
    .max(100, 'Sabit değer en fazla 100 karakter olabilir.')
    .optional()
    .describe('Sabit sütunun her satırdaki değeri (ör. şube kodu)'),
})
export type PayrollExportColumn = z.output<typeof columnSchema>

/** Kurumun sütun eşleme şablonu (K-339): biçim ve sütun adı/sırası; satırları değiştirmez. */
export const payrollExportProfileSchema = z
  .strictObject({
    separator: z.enum(EXPORT_SEPARATORS, 'Ayırıcıyı seçin.'),
    dateFormat: z
      .enum(EXPORT_DATE_FORMATS, 'Tarih biçimini seçin.')
      .describe('`iso` YYYY-AA-GG, `tr` GG.AA.YYYY'),
    decimal: z.enum(EXPORT_DECIMALS, 'Ondalık işaretini seçin.'),
    columns: z
      .array(columnSchema)
      .min(1, 'En az bir sütun seçin.')
      .max(30, 'En fazla 30 sütun eklenebilir.')
      .superRefine((columns, context) => {
        const allowed = new Set(PAYROLL_EXPORT_COLUMN_OPTIONS.map((item) => item.source))
        const seen = new Set<string>()
        columns.forEach((column, index) => {
          if (column.source === FIXED_COLUMN_SOURCE) {
            if (!column.value)
              context.addIssue({
                code: 'custom',
                path: [index, 'value'],
                message: 'Sabit değeri girin.',
              })
          } else if (!allowed.has(column.source))
            context.addIssue({
              code: 'custom',
              path: [index, 'source'],
              message: 'Bu sütun dosyada bulunmuyor.',
            })
          const name = column.header.toLocaleLowerCase('tr')
          if (seen.has(name))
            context.addIssue({
              code: 'custom',
              path: [index, 'header'],
              message: 'Aynı başlık iki kez kullanılamaz.',
            })
          seen.add(name)
        })
      }),
  })
  .refine((profile) => profile.separator !== profile.decimal, {
    path: ['decimal'],
    message: 'Ondalık işareti ayırıcıyla aynı olamaz.',
  })
export type PayrollExportProfile = z.output<typeof payrollExportProfileSchema>

/** Gövde: `null` kurumu genel dosyaya döndürür. */
export const setPayrollExportProfileSchema = z.strictObject({
  profile: payrollExportProfileSchema.nullable(),
})

/** Genel dosya (K-336): `;` ayırıcı, ondalık virgül, ISO gün, bütün sütunlar. */
export function defaultPayrollExportProfile(): PayrollExportProfile {
  return {
    separator: ';',
    dateFormat: 'iso',
    decimal: ',',
    columns: PAYROLL_EXPORT_COLUMN_OPTIONS.map(({ source, label }) => ({ source, header: label })),
  }
}

function cellOf(
  column: PayrollExportColumn,
  line: PayrollExportLine,
  profile: PayrollExportProfile,
) {
  const source = (SOURCES as Record<string, Source>)[column.source]
  if (source === undefined) return csvCell(column.value ?? '')
  const value = source.read(line)
  if (value === null) return ''
  if (source.kind === 'amount') return csvAmount(Number(value)).replace(',', profile.decimal)
  if (source.kind === 'integer') return String(value)
  if (source.kind === 'date') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
    return csvCell(
      profile.dateFormat === 'tr' && parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : value,
    )
  }
  return csvCell(value)
}

/**
 * CSV metni (BOM'suz; uç ekler). Profil yoksa genel dosya. Metin hücreleri formül kaçışlıdır;
 * tutar ve sayı hücreleri kaçılmaz, boş değer boş hücredir.
 */
export function payrollExportCsv(
  lines: readonly PayrollExportLine[],
  profile: PayrollExportProfile | null,
): string {
  const format = profile ?? defaultPayrollExportProfile()
  return [
    format.columns.map((column) => csvCell(column.header)),
    ...lines.map((line) => format.columns.map((column) => cellOf(column, line, format))),
  ]
    .map((row) => row.join(format.separator))
    .join('\r\n')
}
