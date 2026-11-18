// Öğretmen çalışma onayı formları ve gösterimi (DOM-FIN-114; ON-174). Formlar düz metin alanlarıdır;
// boş metin gövdede `null` ya da gönderilmeyen alan olur. Sınırlar ve mesajlar core şemalarından
// gelir (aynı mesajlar); onayda geçerlilik bitişi üç seçeneklidir: varsayılan (eğitim yılı sonu),
// gün ya da süresiz (K-376).
import { z } from 'zod'
import type {
  ApproveWorkPermitBody,
  CreateWorkPermitBody,
  WorkPermit,
  WorkPermitTeacher,
} from '@kampus/react-shared/use-finance-work-permits.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  TEACHER_PERMIT_STATUS_LABELS,
  WORK_PERMIT_NOTE_MAX,
  WORK_PERMIT_STATE_LABELS,
  WORK_PERMIT_TYPE_LABELS,
  workPermitApproveSchema,
  workPermitInputSchema,
  type TeacherPermitStatus,
  type WorkPermitState,
} from '@kampus/school-core/lib/finance-work-permits.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/** Gün gösterimi: "1 Eyl 2026". */
export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const STATE_TONES = {
  preparing: 'purple',
  applied: 'amber',
  approved: 'green',
  rejected: 'red',
  expired: 'red',
} as const satisfies Record<WorkPermitState, string>

export const TEACHER_STATUS_TONES = {
  valid: 'green',
  expiring: 'amber',
  expired: 'red',
  missing: 'red',
} as const satisfies Record<TeacherPermitStatus, string>

/** Kayıt başlığı: "İlk onay · İngilizce". */
export const permitTitle = (permit: Pick<WorkPermit, 'permitType' | 'branch'>) =>
  `${WORK_PERMIT_TYPE_LABELS[permit.permitType]} · ${permit.branch}`

/** Geçerlilik metni: "31 Ağu 2027'ye kadar" ya da "süresiz". */
export const validityText = (validUntil: string | null) =>
  validUntil === null ? 'süresiz' : `${dayText(validUntil)} tarihine kadar`

/** Kaydın tarih özeti (başvuru, onay ya da ret). */
export function permitDatesText(
  permit: Pick<
    WorkPermit,
    'applicationDate' | 'approvalDate' | 'approvalNumber' | 'validUntil' | 'rejectionDate'
  >,
): string {
  const parts: string[] = []
  if (permit.applicationDate !== null) parts.push(`Başvuru ${dayText(permit.applicationDate)}`)
  if (permit.approvalDate !== null)
    parts.push(
      `onay ${dayText(permit.approvalDate)} (sayı ${permit.approvalNumber ?? '—'}), ${validityText(permit.validUntil)}`,
    )
  if (permit.rejectionDate !== null) parts.push(`ret ${dayText(permit.rejectionDate)}`)
  return parts.length === 0 ? 'Başvuru yapılmadı' : parts.join(' · ')
}

/** Takip satırının durum metni (K-376): kalan ya da geçen gün dahil. */
export function teacherStatusText(row: Pick<WorkPermitTeacher, 'status' | 'daysLeft'>): string {
  const label = TEACHER_PERMIT_STATUS_LABELS[row.status]
  if (row.daysLeft === null) return label
  if (row.status === 'expiring') return `${label} (${String(row.daysLeft)} gün)`
  if (row.status === 'expired') return `${label} (${String(-row.daysLeft)} gün önce)`
  return label
}

/** Takip satırının geçerli onay özeti. */
export function currentPermitText(row: Pick<WorkPermitTeacher, 'current'>): string {
  if (row.current === null) return '—'
  return `${permitTitle(row.current)}, ${validityText(row.current.validUntil)}`
}

/** Açık başvuru özeti. */
export function openApplicationText(row: Pick<WorkPermitTeacher, 'openApplication'>): string {
  const open = row.openApplication
  if (open === null) return '—'
  const state = WORK_PERMIT_STATE_LABELS[open.status]
  return open.applicationDate === null ? state : `${state} (${dayText(open.applicationDate)})`
}

// --- Yeni kayıt ----------------------------------------------------------------------------------

const noteField = z
  .string()
  .max(WORK_PERMIT_NOTE_MAX, `En fazla ${String(WORK_PERMIT_NOTE_MAX)} karakter girebilirsiniz.`)
const optionalDay = z
  .string()
  .refine((value) => value === '' || daySchema.safeParse(value).success, {
    message: 'Geçerli bir tarih seçin.',
  })

export const permitFormSchema = z.object({
  permitType: workPermitInputSchema.shape.permitType,
  branch: workPermitInputSchema.shape.branch,
  applicationDate: optionalDay,
  note: noteField,
})
export type PermitFormValues = z.input<typeof permitFormSchema>

export const permitDefaults = (branch = ''): PermitFormValues => ({
  permitType: 'initial',
  branch,
  applicationDate: '',
  note: '',
})

export function permitBody(membershipId: string, values: PermitFormValues): CreateWorkPermitBody {
  return {
    membershipId,
    permitType: values.permitType,
    branch: values.branch.trim(),
    applicationDate: values.applicationDate === '' ? null : values.applicationDate,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
}

// --- Onay ----------------------------------------------------------------------------------------

export const VALIDITY_MODES = ['default', 'date', 'unlimited'] as const
export type ValidityMode = (typeof VALIDITY_MODES)[number]
export const VALIDITY_MODE_LABELS = {
  default: 'Eğitim yılı sonu (varsayılan)',
  date: 'Gün seç',
  unlimited: 'Süresiz',
} as const satisfies Record<ValidityMode, string>

export const approveFormSchema = z
  .object({
    approvalDate: workPermitApproveSchema.shape.approvalDate,
    approvalNumber: workPermitApproveSchema.shape.approvalNumber,
    validityMode: z.enum(VALIDITY_MODES),
    validUntil: z.string(),
  })
  .superRefine((value, context) => {
    if (value.validityMode !== 'date') return
    if (!daySchema.safeParse(value.validUntil).success)
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Geçerli bir tarih seçin.',
      })
    else if (value.validUntil < value.approvalDate)
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Geçerlilik bitişi onay gününden önce olamaz.',
      })
  })
export type ApproveFormValues = z.input<typeof approveFormSchema>

export const approveDefaults = (today: string): ApproveFormValues => ({
  approvalDate: today,
  approvalNumber: '',
  validityMode: 'default',
  validUntil: '',
})

/** Onay gövdesi: varsayılan bitişte `validUntil` gönderilmez, süresizde `null` (K-376). */
export function approveBody(
  values: ApproveFormValues,
  documentFileId: string | null,
): ApproveWorkPermitBody {
  return {
    approvalDate: values.approvalDate,
    approvalNumber: values.approvalNumber.trim(),
    ...(values.validityMode === 'default'
      ? {}
      : { validUntil: values.validityMode === 'unlimited' ? null : values.validUntil }),
    documentFileId,
  }
}

/** Gövde alanı → onay formu alanı (sunucu hatası). */
export function approveFormField(name: string): keyof ApproveFormValues | null {
  if (name === 'approvalDate' || name === 'approvalNumber' || name === 'validUntil') return name
  return null
}
