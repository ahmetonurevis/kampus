import { z } from 'zod'

import { ACADEMIC_YEAR_MAX, ACADEMIC_YEAR_MIN } from './academic-years.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { FEE_ITEM_KINDS, type FeeItemKind } from './fee-tariffs.ts'
import { financeCodeSchema, financeNameSchema } from './finance-cost-centers.ts'

/**
 * Bütçe dönemi, bütçe kalemi ve planlanan tutar (docs/domain/finans.md DOM-FIN-062; ON-241,
 * IST-011). Dönem taslak → açık → kapalı ilerler; kapalı dönemde hiçbir şey değişmez. Açık dönemler
 * örtüşmez (K-62). Tutar kuruş tamsayıdır; aylık dağılım isteğe bağlıdır ve toplamı tutara eşittir
 * (K-64). Toplamlar satırlardan hesaplanır, saklanmaz. Fonksiyonlar saftır; kayıtları servis yükler.
 */

/**
 * Bütçeyi yönetici yönetir (K-60). Muhasebe rolü açılınca (OG-110, DOM-FIN-057) bu listeye girer;
 * dönem açma ve kapama `BUDGET_STATUS_ROLES`'te yöneticide kalır (K-61).
 */
export const BUDGET_ROLES = ['yonetici'] as const
export const BUDGET_STATUS_ROLES = ['yonetici'] as const

export const BUDGET_ITEM_KINDS = ['income', 'expense'] as const
export type BudgetItemKind = (typeof BUDGET_ITEM_KINDS)[number]
export const BUDGET_ITEM_KIND_LABELS = {
  income: 'Gelir',
  expense: 'Gider',
} as const satisfies Record<BudgetItemKind, string>

export const BUDGET_PERIOD_STATUSES = ['draft', 'open', 'closed'] as const
export type BudgetPeriodStatus = (typeof BUDGET_PERIOD_STATUSES)[number]
export const BUDGET_PERIOD_STATUS_LABELS = {
  draft: 'Taslak',
  open: 'Açık',
  closed: 'Kapalı',
} as const satisfies Record<BudgetPeriodStatus, string>

/** Dönem en çok 366 gündür (artık yıl dahil bir eğitim yılı). */
export const BUDGET_PERIOD_MAX_DAYS = 366
/** Satır başına en çok 10 milyar TL; kuruş tamsayı, `Number.MAX_SAFE_INTEGER`'ın çok altında. */
export const BUDGET_AMOUNT_MAX_CENTS = 1_000_000_000_000

// --- Kalem ---------------------------------------------------------------------------------------

const feeKindSchema = z.enum(FEE_ITEM_KINDS, 'Ücret türünü seçin.').nullable()

/** Bütçe kalemi; gider kalemi ücret türüne eşlenmez. */
export const budgetItemSchema = z
  .strictObject({
    code: financeCodeSchema,
    name: financeNameSchema,
    kind: z.enum(BUDGET_ITEM_KINDS, 'Kalem türünü seçin.'),
    feeKind: feeKindSchema.default(null),
  })
  .superRefine((value, context) => {
    if (value.kind === 'expense' && value.feeKind !== null)
      context.addIssue({
        code: 'custom',
        path: ['feeKind'],
        message: 'Ücret türü yalnız gelir kalemine eşlenir.',
      })
  })
export type BudgetItemInput = z.input<typeof budgetItemSchema>
export type BudgetItemFields = z.output<typeof budgetItemSchema>

export const updateBudgetItemSchema = z
  .strictObject({
    code: financeCodeSchema.optional(),
    name: financeNameSchema.optional(),
    kind: z.enum(BUDGET_ITEM_KINDS, 'Kalem türünü seçin.').optional(),
    feeKind: feeKindSchema.optional(),
    isActive: z.boolean('Etkinlik durumu açık ya da kapalı olmalıdır.').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateBudgetItemInput = z.input<typeof updateBudgetItemSchema>
export type BudgetItemChanges = z.output<typeof updateBudgetItemSchema>

export interface BudgetItemNode {
  id: string
  code: string
  kind: BudgetItemKind
  feeKind: FeeItemKind | null
  isActive: boolean
}

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflictError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'conflict', path: [path] })

function assertItem(
  draft: Omit<BudgetItemNode, 'id'> & { id: string | null },
  items: readonly BudgetItemNode[],
): void {
  if (draft.kind === 'expense' && draft.feeKind !== null)
    throw ruleError(
      'budget_item_fee_kind_expense',
      'Ücret türü yalnız gelir kalemine eşlenir.',
      'feeKind',
    )
  const others = items.filter((item) => item.id !== draft.id)
  if (others.some((item) => item.code === draft.code))
    throw conflictError('budget_item_code_taken', 'Bu kodla kayıtlı bir bütçe kalemi var.', 'code')
  if (
    draft.isActive &&
    draft.feeKind !== null &&
    others.some((item) => item.isActive && item.feeKind === draft.feeKind)
  )
    throw conflictError(
      'budget_item_fee_kind_taken',
      'Bu ücret türü başka bir etkin gelir kalemine eşli.',
      'feeKind',
    )
}

/** Yeni kalem planı (DOM-FIN-062, K-72); yeni kalem etkindir. */
export function planBudgetItem(input: unknown, items: readonly BudgetItemNode[]): BudgetItemFields {
  const data = budgetItemSchema.parse(input)
  assertItem({ ...data, id: null, isActive: true }, items)
  return data
}

/** Düzeltme planı. Bütçe satırında kullanılan kalemin türü değişmez. */
export function planBudgetItemUpdate(
  current: BudgetItemNode,
  input: unknown,
  context: { items: readonly BudgetItemNode[]; inUse: boolean },
): BudgetItemChanges {
  const changes = updateBudgetItemSchema.parse(input)
  const kind = changes.kind ?? current.kind
  if (kind !== current.kind && context.inUse)
    throw ruleError(
      'budget_item_in_use',
      'Bütçe satırında kullanılan kalemin türü değiştirilemez.',
      'kind',
    )
  assertItem(
    {
      id: current.id,
      code: changes.code ?? current.code,
      kind,
      feeKind: changes.feeKind === undefined ? current.feeKind : changes.feeKind,
      isActive: changes.isActive ?? current.isActive,
    },
    context.items,
  )
  return changes
}

// --- Dönem ---------------------------------------------------------------------------------------

const academicYearSchema = z
  .number('Eğitim yılı sayı olmalıdır.')
  .int('Eğitim yılı tam sayı olmalıdır.')
  .min(ACADEMIC_YEAR_MIN, `Eğitim yılı en az ${String(ACADEMIC_YEAR_MIN)} olabilir.`)
  .max(ACADEMIC_YEAR_MAX, `Eğitim yılı en çok ${String(ACADEMIC_YEAR_MAX)} olabilir.`)

type DatingInput = {
  academicYear?: number | null | undefined
  startDate?: string | undefined
  endDate?: string | undefined
}

/** Dönem ya eğitim yılına ya da gün aralığına bağlanır; ikisi birden ya da yarım aralık olmaz. */
function checkDating(value: DatingInput, context: z.RefinementCtx, required: boolean): void {
  const year = value.academicYear !== undefined && value.academicYear !== null
  const start = value.startDate !== undefined
  const end = value.endDate !== undefined
  if (year && (start || end)) {
    context.addIssue({
      code: 'custom',
      path: ['academicYear'],
      message: 'Eğitim yılı ya da gün aralığından yalnız birini girin.',
    })
    return
  }
  if (start !== end) {
    context.addIssue({
      code: 'custom',
      path: [start ? 'endDate' : 'startDate'],
      message: 'Başlangıç ve bitiş gününü birlikte girin.',
    })
    return
  }
  if (required && !year && !start)
    context.addIssue({
      code: 'custom',
      path: ['academicYear'],
      message: 'Eğitim yılı seçin ya da başlangıç ve bitiş gününü girin.',
    })
}

/** Yeni bütçe dönemi (DOM-FIN-062): eğitim yılı ya da başlangıç ve bitiş günü. */
export const budgetPeriodSchema = z
  .strictObject({
    name: financeNameSchema,
    academicYear: academicYearSchema.nullable().optional(),
    startDate: daySchema.optional(),
    endDate: daySchema.optional(),
  })
  .superRefine((value, context) => checkDating(value, context, true))
export type BudgetPeriodInput = z.input<typeof budgetPeriodSchema>

/** Ad taslakta ve açıkken, günler yalnız taslakta değişir. Yeni eğitim yılı günleri yeniden kopyalar. */
export const updateBudgetPeriodSchema = z
  .strictObject({
    name: financeNameSchema.optional(),
    academicYear: academicYearSchema.optional(),
    startDate: daySchema.optional(),
    endDate: daySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
  .superRefine((value, context) => checkDating(value, context, false))
export type UpdateBudgetPeriodInput = z.input<typeof updateBudgetPeriodSchema>

export interface BudgetPeriodDates {
  startDate: string
  endDate: string
}

export interface BudgetPeriodNode extends BudgetPeriodDates {
  id: string
  name: string
  academicYear: number | null
  status: BudgetPeriodStatus
}

export interface BudgetPeriodFields extends BudgetPeriodDates {
  name: string
  academicYear: number | null
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000

/** Bitiş başlangıçtan önce olamaz; dönem en çok `BUDGET_PERIOD_MAX_DAYS` gün. */
function assertDates(dates: BudgetPeriodDates): void {
  const days = dayNumber(dates.endDate) - dayNumber(dates.startDate) + 1
  if (days < 1)
    throw ruleError(
      'budget_period_dates_invalid',
      'Bitiş günü başlangıç gününden önce olamaz.',
      'endDate',
    )
  if (days > BUDGET_PERIOD_MAX_DAYS)
    throw ruleError(
      'budget_period_too_long',
      `Bütçe dönemi en çok ${String(BUDGET_PERIOD_MAX_DAYS)} gün olabilir.`,
      'endDate',
    )
}

function assertNameFree(
  name: string,
  periods: readonly BudgetPeriodNode[],
  exceptId: string | null,
) {
  if (periods.some((period) => period.id !== exceptId && period.name === name))
    throw conflictError('budget_period_name_taken', 'Bu adla bir bütçe dönemi var.', 'name')
}

/**
 * Yeni dönem planı. `yearDates` eğitim yılına bağlı dönemde servisin bulduğu günlerdir (kurumun yıl
 * kaydı, yoksa 1 Eylül – 31 Ağustos; K-63); gün aralığıyla verilen dönemde kullanılmaz.
 */
export function planBudgetPeriod(
  input: unknown,
  context: {
    periods: readonly BudgetPeriodNode[]
    yearDates: (startYear: number) => BudgetPeriodDates
  },
): BudgetPeriodFields {
  const data = budgetPeriodSchema.parse(input)
  const academicYear = data.academicYear ?? null
  const dates =
    academicYear === null
      ? { startDate: data.startDate ?? '', endDate: data.endDate ?? '' }
      : context.yearDates(academicYear)
  assertDates(dates)
  assertNameFree(data.name, context.periods, null)
  return { name: data.name, academicYear, ...dates }
}

/** Kapalı dönemde hiçbir şey değişmez (DOM-FIN-062). */
export function assertPeriodWritable(period: Pick<BudgetPeriodNode, 'status'>): void {
  if (period.status === 'closed')
    throw ruleError('budget_period_closed', 'Kapalı bütçe döneminde değişiklik yapılamaz.')
}

/** Düzeltme planı: değişen alanlar. Günler yalnız taslakta ve aylık dağılımlı satır yokken değişir. */
export function planBudgetPeriodUpdate(
  current: BudgetPeriodNode,
  input: unknown,
  context: {
    periods: readonly BudgetPeriodNode[]
    yearDates: (startYear: number) => BudgetPeriodDates
    hasDistributedLines: boolean
  },
): Partial<BudgetPeriodFields> {
  const changes = updateBudgetPeriodSchema.parse(input)
  assertPeriodWritable(current)
  const result: Partial<BudgetPeriodFields> = {}
  if (changes.name !== undefined) {
    assertNameFree(changes.name, context.periods, current.id)
    result.name = changes.name
  }
  const redated = changes.academicYear !== undefined || changes.startDate !== undefined
  if (!redated) return result
  if (current.status !== 'draft')
    throw ruleError(
      'budget_period_not_draft',
      'Dönemin günleri yalnız taslakken değiştirilebilir.',
      changes.academicYear !== undefined ? 'academicYear' : 'startDate',
    )
  const dates =
    changes.academicYear !== undefined
      ? context.yearDates(changes.academicYear)
      : { startDate: changes.startDate ?? '', endDate: changes.endDate ?? '' }
  assertDates(dates)
  const moved = dates.startDate !== current.startDate || dates.endDate !== current.endDate
  if (moved && context.hasDistributedLines)
    throw ruleError(
      'budget_period_has_distribution',
      'Aylık dağılımlı satırı olan dönemin günleri değiştirilemez; önce dağılımları kaldırın.',
      changes.academicYear !== undefined ? 'academicYear' : 'startDate',
    )
  return {
    ...result,
    academicYear: changes.academicYear ?? null,
    ...dates,
  }
}

const overlaps = (a: BudgetPeriodDates, b: BudgetPeriodDates) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate

/** Taslak dönemi açar; açık dönemler örtüşmez (K-62). */
export function planBudgetPeriodOpen(
  period: BudgetPeriodNode,
  periods: readonly BudgetPeriodNode[],
): void {
  if (period.status !== 'draft')
    throw ruleError('budget_period_not_draft', 'Yalnız taslak dönem açılabilir.')
  const clash = periods.find(
    (other) => other.id !== period.id && other.status === 'open' && overlaps(other, period),
  )
  if (clash)
    throw ruleError(
      'budget_period_overlap',
      `Bu dönem açık "${clash.name}" dönemiyle örtüşüyor; açık dönemler örtüşemez.`,
    )
}

/** Açık dönemi kapatır; kapanış geri alınmaz (K-61). */
export function planBudgetPeriodClose(period: Pick<BudgetPeriodNode, 'status'>): void {
  if (period.status !== 'open')
    throw ruleError('budget_period_not_open', 'Yalnız açık dönem kapatılabilir.')
}

/** Dönemin değdiği takvim ayları (`YYYY-MM`), sırayla; aylık dağılımın sırası budur. */
export function periodMonths(dates: BudgetPeriodDates): string[] {
  const months: string[] = []
  let year = Number(dates.startDate.slice(0, 4))
  let month = Number(dates.startDate.slice(5, 7))
  const last = dates.endDate.slice(0, 7)
  for (let guard = 0; guard < 24; guard += 1) {
    const key = `${String(year)}-${String(month).padStart(2, '0')}`
    if (key > last) break
    months.push(key)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

/** Tutarı aylara eşit böler; kalan kuruşlar ilk aylara birer birer eklenir (form yardımcısı). */
export function evenMonthlySplit(amountCents: number, monthCount: number): number[] {
  if (monthCount <= 0) return []
  const base = Math.floor(amountCents / monthCount)
  const remainder = amountCents - base * monthCount
  return Array.from({ length: monthCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

// --- Satır ---------------------------------------------------------------------------------------

const amountSchema = z
  .number('Tutarı girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(0, 'Tutar sıfırdan küçük olamaz.')
  .max(BUDGET_AMOUNT_MAX_CENTS, 'Tutar en fazla 10.000.000.000 ₺ olabilir.')
const monthlySchema = z
  .array(amountSchema, 'Aylık dağılım tutar listesi olmalıdır.')
  .min(1, 'Aylık dağılım en az bir ay içerir.')
  .max(24, 'Aylık dağılım en çok 24 ay içerir.')
  .nullable()

/** Dönem × maliyet merkezi × kalem için planlanan tutar (DOM-FIN-062). */
export const budgetLineSchema = z.strictObject({
  costCenterId: z.uuid('Maliyet merkezi seçin.'),
  itemId: z.uuid('Bütçe kalemi seçin.'),
  amountCents: amountSchema,
  monthlyCents: monthlySchema.default(null),
})
export type BudgetLineInput = z.input<typeof budgetLineSchema>
export type BudgetLineFields = z.output<typeof budgetLineSchema>

/** Tutar ve dağılım düzeltilir; merkez ve kalem değişmez. */
export const updateBudgetLineSchema = z
  .strictObject({
    amountCents: amountSchema.optional(),
    monthlyCents: monthlySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateBudgetLineInput = z.input<typeof updateBudgetLineSchema>

/** Dağılım verilmişse dönemin her ayı için bir tutar ve toplam planlanan tutar (K-64). */
function assertMonthly(
  amountCents: number,
  monthlyCents: readonly number[] | null,
  period: BudgetPeriodDates,
): void {
  if (monthlyCents === null) return
  const months = periodMonths(period)
  if (monthlyCents.length !== months.length)
    throw ruleError(
      'budget_line_months_mismatch',
      `Aylık dağılım dönemin ${String(months.length)} ayı için tutar içermelidir.`,
      'monthlyCents',
    )
  const total = monthlyCents.reduce((sum, value) => sum + value, 0)
  if (total !== amountCents)
    throw ruleError(
      'budget_line_monthly_sum',
      'Aylık tutarların toplamı planlanan tutara eşit olmalıdır.',
      'monthlyCents',
    )
}

/**
 * Yeni satır planı. Sıra: dönem yazılabilir → merkez ve kalem var ve etkin → aynı üçlü yok →
 * aylık dağılım.
 */
export function planBudgetLine(
  input: unknown,
  context: {
    period: BudgetPeriodNode
    center: { isActive: boolean } | null
    item: { isActive: boolean } | null
    duplicate: boolean
  },
): BudgetLineFields {
  const data = budgetLineSchema.parse(input)
  assertPeriodWritable(context.period)
  if (context.center === null)
    throw ruleError('cost_center_not_found', 'Maliyet merkezi bulunamadı.', 'costCenterId')
  if (!context.center.isActive)
    throw ruleError(
      'cost_center_inactive',
      'Pasif maliyet merkezine bütçe satırı eklenemez.',
      'costCenterId',
    )
  if (context.item === null)
    throw ruleError('budget_item_not_found', 'Bütçe kalemi bulunamadı.', 'itemId')
  if (!context.item.isActive)
    throw ruleError('budget_item_inactive', 'Pasif bütçe kalemine satır eklenemez.', 'itemId')
  if (context.duplicate)
    throw conflictError(
      'budget_line_exists',
      'Bu dönemde bu merkez ve kalem için satır var; tutarını düzeltin.',
      'itemId',
    )
  assertMonthly(data.amountCents, data.monthlyCents, context.period)
  return data
}

/** Düzeltme planı: sonuç tutar ve dağılım. Tutar değişip dağılım gönderilmezse eski dağılım tutmalı. */
export function planBudgetLineUpdate(
  current: { amountCents: number; monthlyCents: readonly number[] | null },
  input: unknown,
  period: BudgetPeriodNode,
): { amountCents: number; monthlyCents: number[] | null } {
  const changes = updateBudgetLineSchema.parse(input)
  assertPeriodWritable(period)
  const amountCents = changes.amountCents ?? current.amountCents
  const monthlyCents =
    changes.monthlyCents === undefined
      ? current.monthlyCents === null
        ? null
        : [...current.monthlyCents]
      : changes.monthlyCents
  assertMonthly(amountCents, monthlyCents, period)
  return { amountCents, monthlyCents }
}
