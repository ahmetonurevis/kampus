// Demirbaş zimmet ve iade formları (DOM-FIN-086; ON-236). Alan kuralları core şemalarındandır;
// form tek düz nesnedir, gövdede zimmet türüne göre yalnız ilgili alanlar gider. Boş kampüs ve not
// gövdede `null` olur.
import { z } from 'zod'
import type {
  AssignFixedAssetBody,
  FixedAssetAssignee,
  ReturnFixedAssetBody,
} from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  FIXED_ASSET_ASSIGNEE_TYPES,
  FIXED_ASSET_ASSIGNMENT_NOTE_MAX,
  FIXED_ASSET_DAMAGE_NOTE_MIN,
  FIXED_ASSET_RETURN_CONDITIONS,
  locationAssignmentSchema,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { isStaffRole, STAFF_ROLE_LABELS } from '@kampus/school-core/lib/staff-accounts.ts'

const NOTE_MESSAGE = `En fazla ${String(FIXED_ASSET_ASSIGNMENT_NOTE_MAX)} karakter girebilirsiniz.`
const note = z.string().max(FIXED_ASSET_ASSIGNMENT_NOTE_MAX, NOTE_MESSAGE)

export const assignFormSchema = z
  .object({
    assigneeType: z.enum(FIXED_ASSET_ASSIGNEE_TYPES, 'Zimmet alanını seçin.'),
    membershipId: z.string(),
    campusId: z.string(),
    location: z.string(),
    assignedDate: daySchema,
    note,
  })
  .superRefine((value, context) => {
    if (value.assigneeType === 'staff' && value.membershipId.trim() === '')
      context.addIssue({ code: 'custom', path: ['membershipId'], message: 'Personel seçin.' })
    if (value.assigneeType === 'location') {
      const parsed = locationAssignmentSchema.shape.location.safeParse(value.location)
      if (!parsed.success)
        context.addIssue({
          code: 'custom',
          path: ['location'],
          message: parsed.error.issues[0]?.message ?? 'Konumu yazın.',
        })
    }
  })
export type AssignFormValues = z.input<typeof assignFormSchema>
type AssignField = keyof AssignFormValues

/** Konum zimmeti demirbaşın kayıtlı kampüs ve konumunu önerir. */
export function assignDefaults(
  asset: { campusId: string | null; location: string },
  today: string,
): AssignFormValues {
  return {
    assigneeType: 'staff',
    membershipId: '',
    campusId: asset.campusId ?? '',
    location: asset.location,
    assignedDate: today,
    note: '',
  }
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

export function assignBody(values: AssignFormValues): AssignFixedAssetBody {
  if (values.assigneeType === 'staff')
    return {
      assigneeType: 'staff',
      membershipId: values.membershipId,
      assignedDate: values.assignedDate,
      note: blankToNull(values.note),
    }
  return {
    assigneeType: 'location',
    campusId: blankToNull(values.campusId),
    location: values.location.trim(),
    assignedDate: values.assignedDate,
    note: blankToNull(values.note),
  }
}

/** Sunucu alan yolu form alanına çevrilir; bilinmeyen yol formun kök hatasıdır. */
export function assignFormField(name: string): AssignField | undefined {
  return (
    ['assigneeType', 'membershipId', 'campusId', 'location', 'assignedDate', 'note'] as const
  ).find((field) => field === name)
}

export const returnFormSchema = z
  .object({
    returnDate: daySchema,
    condition: z.enum(FIXED_ASSET_RETURN_CONDITIONS, 'İade durumunu seçin.'),
    note,
  })
  .superRefine((value, context) => {
    if (value.condition === 'damaged' && value.note.trim().length < FIXED_ASSET_DAMAGE_NOTE_MIN)
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Hasarı en az 5 karakterle açıklayın.',
      })
  })
export type ReturnFormValues = z.input<typeof returnFormSchema>

export function returnBody(values: ReturnFormValues): ReturnFixedAssetBody {
  return {
    returnDate: values.returnDate,
    condition: values.condition,
    note: blankToNull(values.note),
  }
}

/** Personel seçeneği: "Ad · Rol"; pasif personel seçenekte yer almaz (sunucu da reddeder). */
export function assigneeOptionLabel(assignee: Pick<FixedAssetAssignee, 'name' | 'role'>): string {
  return `${assignee.name} · ${roleLabel(assignee.role)}`
}

export const roleLabel = (role: string | null) =>
  role !== null && isStaffRole(role) ? STAFF_ROLE_LABELS[role] : '—'
