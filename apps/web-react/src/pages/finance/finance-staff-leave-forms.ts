// Personel izin formları ve gösterimi (DOM-FIN-109; ON-181). Formlar düz metin alanlarıdır; gövde
// core şemalarıyla (`leaveProfileSchema`, `leaveRecordSchema`, `leaveTypeUpdateSchema`) aynı
// mesajlarla denetlenir. Düzeltmede yalnız değişen alanlar gönderilir.
import { z } from 'zod'
import type {
  CreateLeaveProfileBody,
  CreateLeaveRecordBody,
  CreateLeaveTypeBody,
  LeaveRecordView,
  LeaveStaffDetail,
  LeaveTypeView,
  UpdateLeaveProfileBody,
  UpdateLeaveTypeBody,
} from '@kampus/react-shared/use-finance-staff-leave.ts'
import {
  CUSTOM_LEAVE_KINDS,
  LEAVE_KIND_LABELS,
  LEAVE_NOTE_MAX,
  leaveProfileSchema,
  leaveRecordSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
  type CustomLeaveKind,
} from '@kampus/school-core/lib/finance-staff-leave.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

type Issue = { path: PropertyKey[]; message: string }
type AddIssue = (issue: { code: 'custom'; path: string[]; message: string }) => void

/** Core şema hatalarını form alanlarına taşır. */
function forward(
  issues: readonly Issue[],
  fieldOf: (path: string) => string | undefined,
  addIssue: AddIssue,
) {
  for (const issue of issues) {
    const field = fieldOf(issue.path.map(String).join('.'))
    addIssue({ code: 'custom', path: field ? [field] : [], message: issue.message })
  }
}

const integerText = /^-?\d{1,4}$/
const parseInteger = (text: string) => (integerText.test(text.trim()) ? Number(text.trim()) : null)

// --- Profil --------------------------------------------------------------------------------------

const profileFields = z.object({
  seniorityStartDate: z.string(),
  birthDate: z.string(),
  openingDate: z.string(),
  openingDays: z.string(),
})
export type LeaveProfileFormValues = z.input<typeof profileFields>
type ProfileField = keyof LeaveProfileFormValues

const PROFILE_FIELDS: Readonly<Record<string, ProfileField>> = {
  seniorityStartDate: 'seniorityStartDate',
  birthDate: 'birthDate',
  openingBalance: 'openingDate',
  'openingBalance.asOf': 'openingDate',
  'openingBalance.days': 'openingDays',
}
export const leaveProfileFormField = (path: string): ProfileField | undefined =>
  PROFILE_FIELDS[path]

type Profile = NonNullable<LeaveStaffDetail['profile']>

export function leaveProfileDefaults(profile: Profile | null): LeaveProfileFormValues {
  return {
    seniorityStartDate: profile?.seniorityStartDate ?? '',
    birthDate: profile?.birthDate ?? '',
    openingDate: profile?.openingBalance?.asOf ?? '',
    openingDays:
      profile?.openingBalance === null || profile === null
        ? ''
        : String(profile.openingBalance.days),
  }
}

function profileValues(values: LeaveProfileFormValues) {
  const opening =
    values.openingDate === '' && values.openingDays.trim() === ''
      ? null
      : { asOf: values.openingDate, days: parseInteger(values.openingDays) ?? Number.NaN }
  return {
    seniorityStartDate: values.seniorityStartDate,
    birthDate: values.birthDate === '' ? null : values.birthDate,
    openingBalance: opening,
  }
}

/** Yeni profil gövdesi. */
export function leaveProfileBody(
  membershipId: string,
  values: LeaveProfileFormValues,
): CreateLeaveProfileBody {
  return { membershipId, ...profileValues(values) }
}

/** Düzeltme gövdesi: yalnız değişen alanlar; değişiklik yoksa boş nesne. */
export function leaveProfileUpdateBody(
  current: Profile,
  values: LeaveProfileFormValues,
): UpdateLeaveProfileBody {
  const next = profileValues(values)
  const sameOpening =
    next.openingBalance === null || current.openingBalance === null
      ? next.openingBalance === current.openingBalance
      : next.openingBalance.asOf === current.openingBalance.asOf &&
        next.openingBalance.days === current.openingBalance.days
  return {
    ...(next.seniorityStartDate === current.seniorityStartDate
      ? {}
      : { seniorityStartDate: next.seniorityStartDate }),
    ...(next.birthDate === current.birthDate ? {} : { birthDate: next.birthDate }),
    ...(sameOpening ? {} : { openingBalance: next.openingBalance }),
  }
}

/** Profil formu: alanlar core şemasından geçer; açılış devrinin iki alanı birlikte doludur. */
export const leaveProfileFormSchema = profileFields.superRefine((values, context) => {
  const openingDate = values.openingDate !== ''
  const openingDays = values.openingDays.trim() !== ''
  if (openingDate !== openingDays) {
    context.addIssue({
      code: 'custom',
      path: [openingDate ? 'openingDays' : 'openingDate'],
      message: 'Açılış devrinin gününü ve gün sayısını birlikte girin.',
    })
    return
  }
  if (openingDays && parseInteger(values.openingDays) === null) {
    context.addIssue({
      code: 'custom',
      path: ['openingDays'],
      message: 'Devreden gün tam sayı olmalıdır.',
    })
    return
  }
  const parsed = leaveProfileSchema.safeParse(leaveProfileBody('m', values))
  if (!parsed.success)
    forward(parsed.error.issues, leaveProfileFormField, (issue) => context.addIssue(issue))
})

// --- Kullanılmış izin ----------------------------------------------------------------------------

const recordFields = z.object({
  typeCode: z.string().min(1, 'İzin türünü seçin.'),
  startDate: z.string(),
  endDate: z.string(),
  days: z.string(),
  note: z
    .string()
    .max(LEAVE_NOTE_MAX, `En fazla ${String(LEAVE_NOTE_MAX)} karakter girebilirsiniz.`),
})
export type LeaveRecordFormValues = z.input<typeof recordFields>
type RecordField = keyof LeaveRecordFormValues
const RECORD_FIELDS: Readonly<Record<string, RecordField>> = {
  typeCode: 'typeCode',
  startDate: 'startDate',
  endDate: 'endDate',
  days: 'days',
  note: 'note',
}
export const leaveRecordFormField = (path: string): RecordField | undefined => RECORD_FIELDS[path]

export function leaveRecordDefaults(today: string): LeaveRecordFormValues {
  return { typeCode: 'annual', startDate: today, endDate: today, days: '1', note: '' }
}

export function leaveRecordBody(
  membershipId: string,
  values: LeaveRecordFormValues,
): CreateLeaveRecordBody {
  return {
    membershipId,
    typeCode: values.typeCode,
    startDate: values.startDate,
    endDate: values.endDate,
    days: parseInteger(values.days) ?? Number.NaN,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
}

export const leaveRecordFormSchema = recordFields.superRefine((values, context) => {
  if (parseInteger(values.days) === null) {
    context.addIssue({ code: 'custom', path: ['days'], message: 'Gün sayısı tam sayı olmalıdır.' })
    return
  }
  const parsed = leaveRecordSchema.safeParse(leaveRecordBody('m', values))
  if (!parsed.success)
    forward(parsed.error.issues, leaveRecordFormField, (issue) => context.addIssue(issue))
})

/** Elle seçilebilen türler: etkin ve rapor dışı (rapor sağlık raporu kaydından gelir). */
export const selectableLeaveTypes = (types: readonly LeaveTypeView[]) =>
  types.filter((type) => type.isActive && type.kind !== 'sick')

// --- Tür ayarı -----------------------------------------------------------------------------------

const typeFields = z.object({
  label: z.string(),
  paid: z.enum(['true', 'false']),
  deductsFromAnnual: z.enum(['true', 'false']),
  defaultDays: z.string(),
  isActive: z.enum(['true', 'false']),
})
export type LeaveTypeFormValues = z.input<typeof typeFields>
type TypeField = keyof LeaveTypeFormValues
const TYPE_FIELDS: Readonly<Record<string, TypeField>> = {
  label: 'label',
  paid: 'paid',
  deductsFromAnnual: 'deductsFromAnnual',
  defaultDays: 'defaultDays',
  isActive: 'isActive',
}
export const leaveTypeFormField = (path: string): TypeField | undefined => TYPE_FIELDS[path]

const flag = (value: boolean) => (value ? 'true' : 'false')

export function leaveTypeDefaults(type: LeaveTypeView): LeaveTypeFormValues {
  return {
    label: type.label,
    paid: flag(type.paid),
    deductsFromAnnual: flag(type.deductsFromAnnual),
    defaultDays: type.defaultDays === null ? '' : String(type.defaultDays),
    isActive: flag(type.isActive),
  }
}

const daysOf = (text: string) => (text.trim() === '' ? null : (parseInteger(text) ?? Number.NaN))

/** Tür ayarı gövdesi: yalnız değişen alanlar. */
export function leaveTypeUpdateBody(
  type: LeaveTypeView,
  values: LeaveTypeFormValues,
): UpdateLeaveTypeBody {
  const label = values.label.trim()
  const defaultDays = daysOf(values.defaultDays)
  return {
    ...(label === type.label ? {} : { label }),
    ...(values.paid === flag(type.paid) ? {} : { paid: values.paid === 'true' }),
    ...(values.deductsFromAnnual === flag(type.deductsFromAnnual)
      ? {}
      : { deductsFromAnnual: values.deductsFromAnnual === 'true' }),
    ...(defaultDays === type.defaultDays ? {} : { defaultDays }),
    ...(values.isActive === flag(type.isActive) ? {} : { isActive: values.isActive === 'true' }),
  }
}

export function leaveTypeFormSchema(type: LeaveTypeView) {
  return typeFields.superRefine((values, context) => {
    const body = leaveTypeUpdateBody(type, values)
    if (Object.keys(body).length === 0) {
      context.addIssue({ code: 'custom', path: ['label'], message: 'İzin türünde değişiklik yok.' })
      return
    }
    const parsed = leaveTypeUpdateSchema.safeParse(body)
    if (!parsed.success)
      forward(parsed.error.issues, leaveTypeFormField, (issue) => context.addIssue(issue))
  })
}

const newTypeFields = typeFields.omit({ isActive: true }).extend({
  kind: z.enum(CUSTOM_LEAVE_KINDS, 'Tür biçimini seçin.'),
})
export type NewLeaveTypeFormValues = z.input<typeof newTypeFields>

export const NEW_LEAVE_TYPE_DEFAULTS: NewLeaveTypeFormValues = {
  kind: 'excuse',
  label: '',
  paid: 'true',
  deductsFromAnnual: 'false',
  defaultDays: '',
}
export const CUSTOM_KIND_OPTIONS = CUSTOM_LEAVE_KINDS.map((value: CustomLeaveKind) => ({
  value,
  label: LEAVE_KIND_LABELS[value],
}))

export function newLeaveTypeBody(values: NewLeaveTypeFormValues): CreateLeaveTypeBody {
  return {
    kind: values.kind,
    label: values.label.trim(),
    paid: values.kind === 'unpaid' ? false : values.paid === 'true',
    deductsFromAnnual: values.deductsFromAnnual === 'true',
    defaultDays: daysOf(values.defaultDays),
  }
}

export const newLeaveTypeFormSchema = newTypeFields.superRefine((values, context) => {
  const parsed = leaveTypeCreateSchema.safeParse(newLeaveTypeBody(values))
  if (!parsed.success)
    forward(parsed.error.issues, leaveTypeFormField, (issue) => context.addIssue(issue))
})

// --- Gösterim ------------------------------------------------------------------------------------

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
export const daysText = (days: number) => `${String(days)} gün`

/** Kayıt aralığı: "6 Tem 2026 – 10 Tem 2026" ya da tek gün. */
export const rangeText = (record: Pick<LeaveRecordView, 'startDate' | 'endDate'>) =>
  record.startDate === record.endDate
    ? dayText(record.startDate)
    : `${dayText(record.startDate)} – ${dayText(record.endDate)}`

/** Kaydın etiketi: "Yıllık ücretli izin, 6 Tem 2026 – 10 Tem 2026, 5 gün". */
export const recordTitle = (record: LeaveRecordView) =>
  `${record.typeLabel}, ${rangeText(record)}, ${daysText(record.days)}`

/** Kaydın işaretleri: ücretli/ücretsiz ve yıllıktan düşer mi. */
export const recordFlags = (record: Pick<LeaveRecordView, 'paid' | 'deductsFromAnnual'>) =>
  `${record.paid ? 'Ücretli' : 'Ücretsiz'} · ${
    record.deductsFromAnnual ? 'yıllık izinden düşer' : 'yıllık izinden düşmez'
  }`

/** Türün özelliği: "Ücretli · yıllıktan düşmez · 3 gün (yasal en az 3)". */
export function typeFacts(type: LeaveTypeView): string {
  const parts = [
    type.paid ? 'Ücretli' : 'Ücretsiz',
    type.deductsFromAnnual ? 'yıllık izinden düşer' : 'yıllık izinden düşmez',
  ]
  if (type.defaultDays !== null)
    parts.push(
      type.statutoryMinDays === null
        ? daysText(type.defaultDays)
        : `${daysText(type.defaultDays)} (yasal en az ${String(type.statutoryMinDays)})`,
    )
  if (!type.isActive) parts.push('kapalı')
  return parts.join(' · ')
}

/** Hak ediş satırı: "6. yıl · 15 Mar 2026 · 20 gün (yaş kuralı)". */
export function accrualText(accrual: {
  serviceYear: number
  date: string
  days: number
  ageRule: boolean
}): string {
  return `${String(accrual.serviceYear)}. yıl · ${dayText(accrual.date)} · ${daysText(accrual.days)}${
    accrual.ageRule ? ' (yaş kuralı, en az 20)' : ''
  }`
}
