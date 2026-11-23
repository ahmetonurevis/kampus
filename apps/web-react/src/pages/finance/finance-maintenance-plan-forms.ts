// Periyodik bakım planı formları ve görünümü (DOM-FIN-092; ON-240). Alan kuralları core
// şemalarındandır; boş bırakılabilen alan formda boş metin, gövdede `null` olur. Periyot formda
// metindir, gövdede tam sayı.
import { z } from 'zod'
import type {
  CreateMaintenancePlanBody,
  MaintenanceInspectionBody,
  MaintenancePlanDetail,
  MaintenancePlanRow,
  UpdateMaintenancePlanBody,
} from '@kampus/react-shared/use-finance-maintenance-plans.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  MAINTENANCE_INSPECTION_NOTE_MAX,
  MAINTENANCE_INSPECTION_NOTE_MIN,
  MAINTENANCE_INSPECTION_RESULT_LABELS,
  MAINTENANCE_INSPECTION_RESULTS,
  MAINTENANCE_PLAN_DUE_STATUS_LABELS,
  MAINTENANCE_PLAN_PERIOD_MAX,
  MAINTENANCE_PLAN_PERIOD_MIN,
  MAINTENANCE_PLAN_TYPE_DEFAULTS,
  MAINTENANCE_PLAN_TYPES,
  maintenanceInspectionCancelSchema,
  maintenanceInspectionSchema,
  maintenancePlanSchema,
  type MaintenanceInspectionResult,
  type MaintenancePlanDueStatus,
  type MaintenancePlanType,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export const MAINTENANCE_PLAN_DUE_VIEW: Readonly<
  Record<MaintenancePlanDueStatus, { label: string; tone: BadgeTone }>
> = {
  overdue: { label: MAINTENANCE_PLAN_DUE_STATUS_LABELS.overdue, tone: 'red' },
  due_soon: { label: MAINTENANCE_PLAN_DUE_STATUS_LABELS.due_soon, tone: 'amber' },
  ok: { label: MAINTENANCE_PLAN_DUE_STATUS_LABELS.ok, tone: 'green' },
  never: { label: MAINTENANCE_PLAN_DUE_STATUS_LABELS.never, tone: 'amber' },
}
export const MAINTENANCE_INSPECTION_RESULT_VIEW: Readonly<
  Record<MaintenanceInspectionResult, { label: string; tone: BadgeTone }>
> = {
  pass: { label: MAINTENANCE_INSPECTION_RESULT_LABELS.pass, tone: 'green' },
  fail: { label: MAINTENANCE_INSPECTION_RESULT_LABELS.fail, tone: 'red' },
  partial: { label: MAINTENANCE_INSPECTION_RESULT_LABELS.partial, tone: 'amber' },
}

/** Takvimin tek satırlık metni: kalan ya da geciken gün; hiç denetim yoksa uyarı. */
export function dueText(plan: Pick<MaintenancePlanRow, 'dueStatus' | 'daysLeft'>): string {
  if (plan.daysLeft === null) return 'Denetim kaydı yok'
  if (plan.daysLeft === 0) return 'Bugün'
  if (plan.daysLeft < 0) return `${String(-plan.daysLeft)} gün gecikti`
  return `${String(plan.daysLeft)} gün kaldı`
}

/** Sorumlunun tek satırlık adı; yoksa tire. */
export function responsibleText(responsible: MaintenancePlanRow['responsible']): string {
  if (responsible === null) return '—'
  if (responsible.type === 'staff') return responsible.name ?? 'Personel'
  return responsible.name ? `${responsible.name} (tedarikçi)` : 'Tedarikçi'
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const shape = maintenancePlanSchema.shape
const PERIOD_MESSAGE = `Periyodu ${String(MAINTENANCE_PLAN_PERIOD_MIN)}–${String(MAINTENANCE_PLAN_PERIOD_MAX)} arasında tam ay olarak girin.`

/** Formdaki periyot metni; geçersizse `null`. */
export function parsePeriod(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null
  const value = Number(text.trim())
  return value >= MAINTENANCE_PLAN_PERIOD_MIN && value <= MAINTENANCE_PLAN_PERIOD_MAX ? value : null
}

/** Türün önerdiği periyot (form metni) ve yasal işaret (K-252). */
export const suggestedFor = (type: MaintenancePlanType) => ({
  periodMonths: String(MAINTENANCE_PLAN_TYPE_DEFAULTS[type].periodMonths),
  isLegal: MAINTENANCE_PLAN_TYPE_DEFAULTS[type].isLegal,
})

// --- Plan ----------------------------------------------------------------------------------------

export const planFormSchema = z
  .object({
    name: shape.name,
    type: z.enum(MAINTENANCE_PLAN_TYPES, 'Türü seçin.'),
    campusId: z.string(),
    location: shape.location,
    assetTagNumber: z.string().superRefine((value, context) => {
      const parsed = shape.assetTagNumber.safeParse(value)
      if (!parsed.success)
        context.addIssue({
          code: 'custom',
          message: parsed.error.issues[0]?.message ?? 'Etiket numarası geçersiz.',
        })
    }),
    periodMonths: z.string().refine((value) => parsePeriod(value) !== null, PERIOD_MESSAGE),
    isLegal: z.boolean(),
    lastDoneDate: z.union([z.literal(''), daySchema]),
    responsibleType: z.enum(['', 'staff', 'supplier']),
    membershipId: z.string(),
    supplierId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.responsibleType === 'staff' && value.membershipId.trim() === '')
      context.addIssue({ code: 'custom', path: ['membershipId'], message: 'Personel seçin.' })
    if (value.responsibleType === 'supplier' && value.supplierId.trim() === '')
      context.addIssue({ code: 'custom', path: ['supplierId'], message: 'Tedarikçi seçin.' })
  })
export type PlanFormValues = z.input<typeof planFormSchema>

/** Yeni planda türün önerisi, düzeltmede planın değerleri. */
export function planDefaults(plan?: MaintenancePlanDetail): PlanFormValues {
  if (!plan)
    return {
      name: '',
      type: 'elevator',
      campusId: '',
      location: '',
      assetTagNumber: '',
      ...suggestedFor('elevator'),
      lastDoneDate: '',
      responsibleType: '',
      membershipId: '',
      supplierId: '',
    }
  return {
    name: plan.name,
    type: plan.type,
    campusId: plan.campusId ?? '',
    location: plan.location,
    assetTagNumber: plan.asset?.tagNumber ?? '',
    periodMonths: String(plan.periodMonths),
    isLegal: plan.isLegal,
    lastDoneDate: plan.previousDoneDate ?? '',
    responsibleType: plan.responsible?.type ?? '',
    membershipId: plan.responsible?.type === 'staff' ? plan.responsible.id : '',
    supplierId: plan.responsible?.type === 'supplier' ? plan.responsible.id : '',
  }
}

function responsibleBody(values: PlanFormValues): CreateMaintenancePlanBody['responsible'] {
  if (values.responsibleType === 'staff')
    return { type: 'staff', membershipId: values.membershipId }
  if (values.responsibleType === 'supplier')
    return { type: 'supplier', supplierId: values.supplierId }
  return null
}

export function planBody(values: PlanFormValues): CreateMaintenancePlanBody {
  return {
    name: values.name.trim(),
    type: values.type,
    campusId: blankToNull(values.campusId),
    location: values.location.trim(),
    assetTagNumber: blankToNull(values.assetTagNumber),
    periodMonths: parsePeriod(values.periodMonths),
    isLegal: values.isLegal,
    lastDoneDate: blankToNull(values.lastDoneDate),
    responsible: responsibleBody(values),
  }
}

/** Düzeltmede yalnız değişen alanlar gider; değişiklik yoksa boş nesne. */
export function planChanges(
  values: PlanFormValues,
  plan: MaintenancePlanDetail,
): UpdateMaintenancePlanBody {
  const next = planBody(values)
  const before = planBody(planDefaults(plan))
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof CreateMaintenancePlanBody)[])
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) changes[key] = next[key]
  return changes as UpdateMaintenancePlanBody
}

/** Sunucu alan yolu form alanına çevrilir (`responsible.membershipId` → `membershipId`). */
export function planFormField(name: string): keyof PlanFormValues | undefined {
  const last = name.split('.').pop() ?? name
  if (name.startsWith('responsible') && (last === 'responsible' || last === 'type'))
    return 'responsibleType'
  return (Object.keys(planFormSchema.shape) as (keyof PlanFormValues)[]).find(
    (field) => field === last,
  )
}

// --- Denetim -------------------------------------------------------------------------------------

const inspectionShape = maintenanceInspectionSchema.shape
export const inspectionFormSchema = z
  .object({
    doneDate: daySchema,
    performedBy: inspectionShape.performedBy,
    result: z.enum(MAINTENANCE_INSPECTION_RESULTS, 'Sonucu seçin.'),
    documentNumber: z.string().max(60, 'En fazla 60 karakter girebilirsiniz.'),
    note: z
      .string()
      .max(
        MAINTENANCE_INSPECTION_NOTE_MAX,
        `En fazla ${String(MAINTENANCE_INSPECTION_NOTE_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.result !== 'pass' && value.note.trim().length < MAINTENANCE_INSPECTION_NOTE_MIN)
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Uygunsuzluğu en az 5 karakterle açıklayın.',
      })
  })
export type InspectionFormValues = z.input<typeof inspectionFormSchema>

/** Denetim formu bugünü ve sorumlunun adını önerir. */
export function inspectionDefaults(
  today: string,
  responsible: MaintenancePlanRow['responsible'],
): InspectionFormValues {
  return {
    doneDate: today,
    performedBy: responsible?.name ?? '',
    result: 'pass',
    documentNumber: '',
    note: '',
  }
}

export function inspectionBody(values: InspectionFormValues): MaintenanceInspectionBody {
  return {
    doneDate: values.doneDate,
    performedBy: values.performedBy.trim(),
    result: values.result,
    documentNumber: blankToNull(values.documentNumber),
    note: blankToNull(values.note),
  }
}

export function inspectionFormField(name: string): keyof InspectionFormValues | undefined {
  return (['doneDate', 'performedBy', 'result', 'documentNumber', 'note'] as const).find(
    (field) => field === name,
  )
}

export const inspectionCancelFormSchema = z.object({
  reason: maintenanceInspectionCancelSchema.shape.reason,
})
export type InspectionCancelFormValues = z.input<typeof inspectionCancelFormSchema>
