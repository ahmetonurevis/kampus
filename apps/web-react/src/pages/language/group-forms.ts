// Grup formu, iptal ve birleştirme formlarının saf yardımcıları (IST-077; DOM-DIL-008, -040…043):
// form şeması (core `createGroupSchema` üzerine), varsayılanlar, gövdeler, kilitli alanlar ve
// sunucu hatasının form alanına eşlenmesi.
import { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  cancelGroupSchema,
  createGroupSchema,
  GROUP_ROOM_MAX,
} from '@kampus/school-core/lib/language-groups.ts'
import {
  groupErrorField,
  type CreateGroupBody,
  type LanguageGroup,
  type UpdateGroupBody,
} from '@kampus/react-shared/language-groups.ts'

/**
 * Form şeması: core kuralları; öğretmen ve derslik formda metin alanıdır (boş = atanmamış), gövdede
 * `null` olur. Çevrim içi grubun dersliği yoktur (gövdede `null`).
 */
export const groupFormSchema = createGroupSchema.extend({
  teacherMembershipId: z.string(),
  room: z.string().trim().max(GROUP_ROOM_MAX, `Derslik adı en çok ${GROUP_ROOM_MAX} karakter.`),
})
export type GroupFormValues = z.input<typeof groupFormSchema>
export type GroupFormOutput = z.output<typeof groupFormSchema>

/** Kursiyeri olan ya da başlamış grupta değişmeyen alanlar (`group_schedule_locked`). */
export const GROUP_LOCKED_FIELDS = ['schedule', 'startDate', 'ageBand'] as const

/** Gün + saat kalıbının bir satırı (formda yeni oturum). */
export const NEW_SLOT = { weekday: 1, startTime: '18:00' } as const

export function groupDefaults(
  group: LanguageGroup | undefined,
  options: { courseId?: string; startDate: string },
): GroupFormValues {
  if (!group)
    return {
      courseId: options.courseId ?? '',
      name: '',
      ageBand: 'adult',
      teacherMembershipId: '',
      delivery: 'in_person',
      room: '',
      schedule: [{ ...NEW_SLOT }],
      startDate: options.startDate,
      capacity: 12,
    }
  return {
    courseId: group.courseId,
    name: group.name,
    ageBand: group.ageBand,
    teacherMembershipId: group.teacherMembershipId ?? '',
    delivery: group.delivery,
    room: group.room ?? '',
    schedule: group.schedule.map((slot) => ({ weekday: slot.weekday, startTime: slot.startTime })),
    startDate: group.startDate,
    capacity: group.capacity ?? 1,
  }
}

/**
 * Takvim kilitli mi (DOM-DIL-008): kursiyeri (etkin ya da dondurulmuş) olan ya da başlamış grupta
 * haftalık kalıp, başlangıç ve yaş bandı değişmez; formda salt okur gösterilir.
 */
export function isScheduleLocked(group: LanguageGroup | undefined): boolean {
  if (!group) return false
  const learners = (group.activeLearners ?? 0) + (group.frozenLearners ?? 0)
  return learners > 0 || group.status === 'running' || group.status === 'completed'
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Oluşturma gövdesi. */
export function createGroupBody(parsed: GroupFormOutput): CreateGroupBody {
  return {
    courseId: parsed.courseId,
    name: parsed.name,
    ageBand: parsed.ageBand,
    teacherMembershipId: blankToNull(parsed.teacherMembershipId),
    delivery: parsed.delivery,
    room: parsed.delivery === 'online' ? null : blankToNull(parsed.room),
    schedule: parsed.schedule,
    startDate: parsed.startDate,
    capacity: parsed.capacity,
  }
}

const sameSchedule = (a: CreateGroupBody['schedule'], b: CreateGroupBody['schedule']) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * PATCH gövdesi: yalnız değişen alanlar; kur hiç gönderilmez, kilitli grupta takvim alanları
 * düşer. Boş nesne "değişiklik yok"tur.
 */
export function groupPatch(group: LanguageGroup, parsed: GroupFormOutput): UpdateGroupBody {
  const before = createGroupBody(groupDefaults(group, { startDate: group.startDate }))
  const after = createGroupBody(parsed)
  const locked = isScheduleLocked(group)
  const body: UpdateGroupBody = {}
  if (after.name !== before.name) body.name = after.name
  if (!locked && after.ageBand !== before.ageBand) body.ageBand = after.ageBand
  if (after.teacherMembershipId !== before.teacherMembershipId)
    body.teacherMembershipId = after.teacherMembershipId ?? null
  if (after.delivery !== before.delivery) body.delivery = after.delivery
  if (after.room !== before.room) body.room = after.room ?? null
  if (!locked && !sameSchedule(after.schedule, before.schedule)) body.schedule = after.schedule
  if (!locked && after.startDate !== before.startDate) body.startDate = after.startDate
  if (after.capacity !== before.capacity) body.capacity = after.capacity
  return body
}

const GROUP_FORM_FIELDS: ReadonlySet<string> = new Set([
  'courseId',
  'name',
  'ageBand',
  'teacherMembershipId',
  'delivery',
  'room',
  'schedule',
  'startDate',
  'capacity',
])

/**
 * Hatanın grup formundaki alanı: takvim hataları oturum satırına (`schedule.<sıra>`) ya da kalıbın
 * tamamına (`schedule`), diğerleri koddan alana. Formda olmayan alan `undefined` (toast).
 */
export function groupFormErrorField(error: ApiError): string | undefined {
  const field = groupErrorField(error, 'group')
  if (field === undefined) return undefined
  const head = field.split('.')[0] ?? field
  if (!GROUP_FORM_FIELDS.has(head)) return undefined
  return field
}

export const cancelFormSchema = cancelGroupSchema
export type CancelFormValues = z.input<typeof cancelFormSchema>

export const mergeFormSchema = z.object({
  sourceGroupId: z.string().min(1, 'Birleştirilecek grubu seçin.'),
  learnersConsented: z.boolean(),
})
export type MergeFormValues = z.input<typeof mergeFormSchema>

/** Birleştirme formunda kaynak seçimi ve onay kutusu hata alır; diğerleri toast. */
export function mergeFormErrorField(
  error: ApiError,
): 'sourceGroupId' | 'learnersConsented' | undefined {
  const field = groupErrorField(error, 'merge')
  return field === 'sourceGroupId' || field === 'learnersConsented' ? field : undefined
}
