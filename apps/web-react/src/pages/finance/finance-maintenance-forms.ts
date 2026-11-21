// Arıza ve bakım talebi formları (DOM-FIN-089; ON-239). Alan kuralları core şemalarındandır; boş
// bırakılabilen alan formda boş metin, gövdede `null` olur. Maliyet formda `1.234,56` metnidir,
// gövdede kuruş.
import { z } from 'zod'
import type {
  AssignMaintenanceBody,
  MaintenanceRequestRow,
  ReportMaintenanceBody,
  ResolveMaintenanceBody,
} from '@kampus/react-shared/use-finance-maintenance-requests.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  MAINTENANCE_ASSIGNEE_TYPES,
  MAINTENANCE_COST_MAX_CENTS,
  MAINTENANCE_NOTE_MAX,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  maintenanceAssigneeLabel,
  maintenanceCancelSchema,
  maintenanceRequestSchema,
  maintenanceResolveSchema,
  type MaintenancePriority,
  type MaintenanceStatus,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export const MAINTENANCE_STATUS_VIEW: Readonly<
  Record<MaintenanceStatus, { label: string; tone: BadgeTone }>
> = {
  open: { label: MAINTENANCE_STATUS_LABELS.open, tone: 'amber' },
  assigned: { label: MAINTENANCE_STATUS_LABELS.assigned, tone: 'purple' },
  in_progress: { label: MAINTENANCE_STATUS_LABELS.in_progress, tone: 'purple' },
  resolved: { label: MAINTENANCE_STATUS_LABELS.resolved, tone: 'green' },
  closed: { label: MAINTENANCE_STATUS_LABELS.closed, tone: 'gray' },
  cancelled: { label: MAINTENANCE_STATUS_LABELS.cancelled, tone: 'gray' },
}
export const MAINTENANCE_PRIORITY_VIEW: Readonly<
  Record<MaintenancePriority, { label: string; tone: BadgeTone }>
> = {
  low: { label: MAINTENANCE_PRIORITY_LABELS.low, tone: 'gray' },
  normal: { label: MAINTENANCE_PRIORITY_LABELS.normal, tone: 'purple' },
  urgent: { label: MAINTENANCE_PRIORITY_LABELS.urgent, tone: 'red' },
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const shape = maintenanceRequestSchema.shape
const note = z
  .string()
  .max(MAINTENANCE_NOTE_MAX, `En fazla ${String(MAINTENANCE_NOTE_MAX)} karakter girebilirsiniz.`)

// --- Bildirim ------------------------------------------------------------------------------------

export const reportFormSchema = z.object({
  title: shape.title,
  description: shape.description,
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
  priority: z.enum(MAINTENANCE_PRIORITIES, 'Önceliği seçin.'),
})
export type ReportFormValues = z.input<typeof reportFormSchema>

/** Demirbaş ayrıntısından açılan bildirim demirbaşın etiketini ve yerini önerir. */
export function reportDefaults(
  asset?: { tagNumber: string; campusId: string | null; location: string } | null,
): ReportFormValues {
  return {
    title: '',
    description: '',
    campusId: asset?.campusId ?? '',
    location: asset?.location ?? '',
    assetTagNumber: asset?.tagNumber ?? '',
    priority: 'normal',
  }
}

export function reportBody(values: ReportFormValues): ReportMaintenanceBody {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    campusId: blankToNull(values.campusId),
    location: values.location.trim(),
    assetTagNumber: blankToNull(values.assetTagNumber),
    priority: values.priority,
  }
}

/** Sunucu alan yolu form alanına çevrilir; bilinmeyen yol formun kök hatasıdır. */
export function reportFormField(name: string): keyof ReportFormValues | undefined {
  return (Object.keys(reportFormSchema.shape) as (keyof ReportFormValues)[]).find(
    (field) => field === name,
  )
}

// --- Atama ---------------------------------------------------------------------------------------

export const assignFormSchema = z
  .object({
    assigneeType: z.enum(MAINTENANCE_ASSIGNEE_TYPES, 'Sorumlu türünü seçin.'),
    membershipId: z.string(),
    supplierId: z.string(),
    note,
  })
  .superRefine((value, context) => {
    if (value.assigneeType === 'staff' && value.membershipId.trim() === '')
      context.addIssue({ code: 'custom', path: ['membershipId'], message: 'Personel seçin.' })
    if (value.assigneeType === 'supplier' && value.supplierId.trim() === '')
      context.addIssue({ code: 'custom', path: ['supplierId'], message: 'Tedarikçi seçin.' })
  })
export type AssignFormValues = z.input<typeof assignFormSchema>

export function assignDefaults(
  assignee: MaintenanceRequestRow['assignee'] | undefined,
): AssignFormValues {
  return {
    assigneeType: assignee?.type ?? 'staff',
    membershipId: assignee?.type === 'staff' ? assignee.id : '',
    supplierId: assignee?.type === 'supplier' ? assignee.id : '',
    note: '',
  }
}

export function assignBody(values: AssignFormValues): AssignMaintenanceBody {
  if (values.assigneeType === 'staff')
    return {
      assigneeType: 'staff',
      membershipId: values.membershipId,
      note: blankToNull(values.note),
    }
  return { assigneeType: 'supplier', supplierId: values.supplierId, note: blankToNull(values.note) }
}

export function assignFormField(name: string): keyof AssignFormValues | undefined {
  return (['assigneeType', 'membershipId', 'supplierId', 'note'] as const).find(
    (field) => field === name,
  )
}

// --- Çözüm ---------------------------------------------------------------------------------------

const COST_MESSAGE = 'Maliyeti 1.234,56 biçiminde, sıfırdan büyük girin ya da boş bırakın.'
export const parseCost = (text: string) =>
  text.trim() === '' ? null : parseAmountInput(text, { maxCents: MAINTENANCE_COST_MAX_CENTS })

export const resolveFormSchema = z.object({
  resolvedDate: daySchema,
  resolution: maintenanceResolveSchema.shape.resolution,
  cost: z.string().refine((value) => value.trim() === '' || parseCost(value) !== null, {
    message: COST_MESSAGE,
  }),
  supplierId: z.string(),
})
export type ResolveFormValues = z.input<typeof resolveFormSchema>

/** Çözüm formu atanan tedarikçiyi önerir. */
export function resolveDefaults(
  assignee: MaintenanceRequestRow['assignee'] | undefined,
  today: string,
): ResolveFormValues {
  return {
    resolvedDate: today,
    resolution: '',
    cost: '',
    supplierId: assignee?.type === 'supplier' ? assignee.id : '',
  }
}

export function resolveBody(values: ResolveFormValues): ResolveMaintenanceBody {
  return {
    resolvedDate: values.resolvedDate,
    resolution: values.resolution.trim(),
    costCents: parseCost(values.cost),
    supplierId: blankToNull(values.supplierId),
  }
}

/** `costCents` → `cost`; bilinmeyen yol formun kök hatasıdır. */
export function resolveFormField(name: string): keyof ResolveFormValues | undefined {
  if (name === 'costCents') return 'cost'
  return (['resolvedDate', 'resolution', 'supplierId'] as const).find((field) => field === name)
}

// --- İptal ve not --------------------------------------------------------------------------------

export const cancelFormSchema = z.object({ reason: maintenanceCancelSchema.shape.reason })
export type CancelFormValues = z.input<typeof cancelFormSchema>

export const noteFormSchema = z.object({ note })
export type NoteFormValues = z.input<typeof noteFormSchema>
export const noteBody = (values: NoteFormValues) => ({ note: blankToNull(values.note) })

/** Sorumlunun tek satırlık adı; atanmamışsa tire. */
export function assigneeText(assignee: MaintenanceRequestRow['assignee']): string {
  if (assignee === null) return '—'
  return maintenanceAssigneeLabel({ assigneeType: assignee.type, name: assignee.name })
}
