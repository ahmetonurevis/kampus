import { z } from 'zod'
import type {
  BudgetItem,
  BudgetLine,
  BudgetPeriod,
  CostCenter,
  CreateBudgetItemBody,
  CreateBudgetPeriodBody,
  CreateCostCenterBody,
} from '@kampus/react-shared/use-finance-budget.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  BUDGET_AMOUNT_MAX_CENTS,
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_STATUS_LABELS,
  evenMonthlySplit,
  type BudgetPeriodStatus,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  COST_CENTER_TYPES,
  financeCodeSchema,
  financeNameSchema,
} from '@kampus/school-core/lib/finance-cost-centers.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Bütçe ve maliyet merkezi formları (DOM-FIN-062). Alan kuralları core şemalarındandır; form
// alanları metindir, gönderimde sayıya ve `null`'a çevrilir. Tutar `1.234,56` biçiminde girilir.

export const PERIOD_STATUS_VIEW: Readonly<
  Record<BudgetPeriodStatus, { label: string; tone: BadgeTone }>
> = {
  draft: { label: BUDGET_PERIOD_STATUS_LABELS.draft, tone: 'amber' },
  open: { label: BUDGET_PERIOD_STATUS_LABELS.open, tone: 'green' },
  closed: { label: BUDGET_PERIOD_STATUS_LABELS.closed, tone: 'gray' },
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const fieldOf =
  <T extends string>(fields: readonly T[]) =>
  (name: string) =>
    fields.find((field) => field === name)

/** `1.234,56` → kuruş; sıfır kabul edilir, üst sınır satır sınırıdır. */
export const parseBudgetAmount = (text: string) =>
  parseAmountInput(text, { allowZero: true, maxCents: BUDGET_AMOUNT_MAX_CENTS })
const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde girin (en fazla 10.000.000.000 ₺).'
const amountText = z
  .string()
  .refine((value) => parseBudgetAmount(value) !== null, { message: AMOUNT_MESSAGE })

// --- Maliyet merkezi -----------------------------------------------------------------------------

export const centerFormSchema = z
  .object({
    code: financeCodeSchema,
    name: financeNameSchema,
    type: z.enum(COST_CENTER_TYPES, 'Merkez türünü seçin.'),
    parentId: z.string(),
    campusId: z.string(),
    gradeLevel: z.string(),
    courseId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.type === 'campus' && value.campusId === '')
      context.addIssue({ code: 'custom', path: ['campusId'], message: 'Kampüs seçin.' })
  })
export type CenterFormValues = z.input<typeof centerFormSchema>
export const centerFormField = fieldOf([
  'code',
  'name',
  'type',
  'parentId',
  'campusId',
  'gradeLevel',
  'courseId',
] as const)

export function centerDefaults(center?: CostCenter): CenterFormValues {
  return {
    code: center?.code ?? '',
    name: center?.name ?? '',
    type: center?.type ?? 'campus',
    parentId: center?.parentId ?? '',
    campusId: center?.campusId ?? '',
    gradeLevel:
      center?.gradeLevel === null || center === undefined ? '' : String(center.gradeLevel),
    courseId: center?.courseId ?? '',
  }
}

/** Tür dışındaki bağ alanları boşaltılır; sunucu tür–bağ uyumunu yeniden denetler. */
export function centerBody(values: CenterFormValues): CreateCostCenterBody {
  const program = values.type === 'program'
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    type: values.type,
    parentId: blankToNull(values.parentId),
    campusId: values.type === 'campus' ? blankToNull(values.campusId) : null,
    gradeLevel: program && values.gradeLevel !== '' ? Number(values.gradeLevel) : null,
    courseId: program ? blankToNull(values.courseId) : null,
  }
}

// --- Kalem ---------------------------------------------------------------------------------------

export const itemFormSchema = z
  .object({
    code: financeCodeSchema,
    name: financeNameSchema,
    kind: z.enum(BUDGET_ITEM_KINDS, 'Kalem türünü seçin.'),
    feeKind: z.union([z.literal(''), z.enum(FEE_ITEM_KINDS)]),
  })
  .superRefine((value, context) => {
    if (value.kind === 'expense' && value.feeKind !== '')
      context.addIssue({
        code: 'custom',
        path: ['feeKind'],
        message: 'Ücret türü yalnız gelir kalemine eşlenir.',
      })
  })
export type ItemFormValues = z.input<typeof itemFormSchema>
export const itemFormField = fieldOf(['code', 'name', 'kind', 'feeKind'] as const)

export const itemDefaults = (item?: BudgetItem): ItemFormValues => ({
  code: item?.code ?? '',
  name: item?.name ?? '',
  kind: item?.kind ?? 'income',
  feeKind: item?.feeKind ?? '',
})

export const itemBody = (values: ItemFormValues): CreateBudgetItemBody => ({
  code: values.code.trim(),
  name: values.name.trim(),
  kind: values.kind,
  feeKind: values.kind === 'income' && values.feeKind !== '' ? values.feeKind : null,
})

// --- Dönem ---------------------------------------------------------------------------------------

export const periodFormSchema = z
  .object({
    name: financeNameSchema,
    mode: z.enum(['year', 'range']),
    academicYear: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'year') {
      if (!/^\d{4}$/.test(value.academicYear))
        context.addIssue({ code: 'custom', path: ['academicYear'], message: 'Eğitim yılı seçin.' })
      return
    }
    for (const field of ['startDate', 'endDate'] as const)
      if (!daySchema.safeParse(value[field]).success)
        context.addIssue({ code: 'custom', path: [field], message: 'Geçerli bir tarih seçin.' })
  })
export type PeriodFormValues = z.input<typeof periodFormSchema>
export const periodFormField = fieldOf(['name', 'academicYear', 'startDate', 'endDate'] as const)

export const periodDefaults = (academicYear: number, period?: BudgetPeriod): PeriodFormValues => ({
  name: period?.name ?? '',
  mode: period && period.academicYear === null ? 'range' : 'year',
  academicYear: String(period?.academicYear ?? academicYear),
  startDate: period?.startDate ?? '',
  endDate: period?.endDate ?? '',
})

export const periodBody = (values: PeriodFormValues): CreateBudgetPeriodBody =>
  values.mode === 'year'
    ? { name: values.name.trim(), academicYear: Number(values.academicYear) }
    : { name: values.name.trim(), startDate: values.startDate, endDate: values.endDate }

/** Düzeltme gövdesi: yalnız değişen ad ve (taslakta) değişen günler gönderilir. */
export function periodUpdateBody(values: PeriodFormValues, period: BudgetPeriod) {
  const body: { name?: string; academicYear?: number; startDate?: string; endDate?: string } = {}
  if (values.name.trim() !== period.name) body.name = values.name.trim()
  if (period.status !== 'draft') return body
  if (values.mode === 'year') {
    const year = Number(values.academicYear)
    if (year !== period.academicYear) body.academicYear = year
  } else if (
    period.academicYear !== null ||
    values.startDate !== period.startDate ||
    values.endDate !== period.endDate
  ) {
    body.startDate = values.startDate
    body.endDate = values.endDate
  }
  return body
}

// --- Satır ---------------------------------------------------------------------------------------

export const DISTRIBUTIONS = ['none', 'even', 'manual'] as const
export type Distribution = (typeof DISTRIBUTIONS)[number]

export const lineFormSchema = z
  .object({
    costCenterId: z.string().min(1, 'Maliyet merkezi seçin.'),
    itemId: z.string().min(1, 'Bütçe kalemi seçin.'),
    amount: amountText,
    distribution: z.enum(DISTRIBUTIONS),
    monthly: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (value.distribution !== 'manual') return
    value.monthly.forEach((month, index) => {
      if (parseBudgetAmount(month) === null)
        context.addIssue({ code: 'custom', path: ['monthly', index], message: AMOUNT_MESSAGE })
    })
    const amount = parseBudgetAmount(value.amount)
    const total = value.monthly.reduce((sum, month) => sum + (parseBudgetAmount(month) ?? 0), 0)
    if (amount !== null && total !== amount)
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Aylık tutarların toplamı planlanan tutara eşit olmalıdır.',
      })
  })
export type LineFormValues = z.input<typeof lineFormSchema>
export const lineFormField = (name: string) =>
  name === 'amountCents' || name === 'monthlyCents'
    ? 'amount'
    : fieldOf(['costCenterId', 'itemId'] as const)(name)

export function lineDefaults(months: readonly string[], line?: BudgetLine): LineFormValues {
  const monthly = line?.monthlyCents
  return {
    costCenterId: line?.costCenterId ?? '',
    itemId: line?.itemId ?? '',
    amount: line ? amountInputValue(line.amountCents) : '',
    distribution: monthly ? 'manual' : 'none',
    monthly: months.map((_, index) =>
      monthly?.[index] === undefined ? '' : amountInputValue(monthly[index]),
    ),
  }
}

/** Tutar ve dağılım gövdesi; eşit bölmede kalan kuruş ilk aylara yazılır. */
export function lineAmounts(values: LineFormValues, monthCount: number) {
  const amountCents = parseBudgetAmount(values.amount) ?? 0
  const monthlyCents =
    values.distribution === 'none'
      ? null
      : values.distribution === 'even'
        ? evenMonthlySplit(amountCents, monthCount)
        : values.monthly.map((month) => parseBudgetAmount(month) ?? 0)
  return { amountCents, monthlyCents }
}

/** `2026-09` → `Eyl 2026` (Europe/Istanbul gösterimi; gün önemsiz). */
const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
})
export const monthLabel = (month: string) =>
  monthFormatter.format(new Date(`${month}-15T09:00:00Z`))
