// Randevu formlarının saf mantığı: tür seçenekleri, alınabilir saatlerin günlere bölünmesi, talep
// ve durum değişikliği gövdeleri. Kuralın kendisi core'dadır (`lib/appointments.ts`); burası
// kullanıcıya seçemeyeceği şeyi göstermemek ve sunucuya gereksiz istek atmamak içindir. Karar
// yine sunucudadır (DOM-ILT-100…102, DOM-ILT-105).
import { z } from 'zod'
import {
  APPOINTMENT_NOTE_MAX_LENGTH,
  APPOINTMENT_REASON_MAX_LENGTH,
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPES_BY_ROLE,
  bookAppointmentSchema,
  updateAppointmentSchema,
  type AppointmentTransition,
  type AppointmentType,
} from '@kampus/school-core/lib/appointments.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BookableSlot } from './appointment-slots.ts'
import type { AppointmentAudience } from './appointment-model.ts'
import type { UpdateAppointmentBody } from './use-appointment-commands.ts'

export { APPOINTMENT_NOTE_MAX_LENGTH, APPOINTMENT_REASON_MAX_LENGTH }

/** Talep eden rolün seçebildiği türler; ilki varsayılandır (DOM-ILT-100). Öğretmen talep açmaz. */
export function appointmentTypes(
  audience: Exclude<AppointmentAudience, 'teacher'>,
): readonly AppointmentType[] {
  return APPOINTMENT_TYPES_BY_ROLE[audience === 'parent' ? 'veli' : 'ogrenci']
}

export const bookFormSchema = z.object({
  slotId: bookAppointmentSchema.shape.slotId,
  type: z.enum(APPOINTMENT_TYPES, 'Görüşme türünü seçin.'),
  note: bookAppointmentSchema.shape.note,
})
export type BookFormValues = z.input<typeof bookFormSchema>

export function bookDefaults(audience: Exclude<AppointmentAudience, 'teacher'>): BookFormValues {
  return { slotId: '', type: appointmentTypes(audience)[0] ?? 'Akademik danışmanlık', note: '' }
}

/** Ekranda bir alınabilir saat: etiket parçaları ve seçilebilirlik. */
export type SlotView = {
  id: string
  /** "13:00 – 13:30". */
  time: string
  teacher: string
  /** Öğretmenin öğrencinin sınıfında verdiği dersler; yoksa boş. */
  subjects: string
  campus: string
  /** `false` saat "Dolu" yazılır; nedeni gösterilmez ve tahmin edilmez (DOM-ILT-105). */
  available: boolean
}
export type SlotGroup = { day: string; label: string; slots: SlotView[] }

const endOf = (startsAt: string, minutes: number) =>
  new Date(Date.parse(startsAt) + minutes * 60_000).toISOString()

export const slotTime = (startsAt: string, duration: number) =>
  `${timeLabel(startsAt)} – ${timeLabel(endOf(startsAt, duration))}`

/** Saatleri İstanbul gününe böler; gün ve gün içi saat sırası korunur. */
export function groupSlots(slots: readonly BookableSlot[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>()
  const ordered = [...slots].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.teacherName.localeCompare(b.teacherName, 'tr'),
  )
  for (const slot of ordered) {
    const day = dayKey(slot.startsAt)
    const group = groups.get(day) ?? {
      day,
      label: dateLabel(slot.startsAt, { weekday: 'long', year: 'numeric' }),
      slots: [],
    }
    group.slots.push({
      id: slot.slotId,
      time: slotTime(slot.startsAt, slot.duration),
      teacher: slot.teacherName,
      subjects: slot.subjectNames.join(', '),
      campus: slot.campusName ?? '',
      available: slot.available,
    })
    groups.set(day, group)
  }
  return [...groups.values()]
}

/** Seçilebilen saat: listede olan ve `available` olan. Dolu ya da listeden düşen saat seçilmez. */
export const selectableSlot = (slots: readonly BookableSlot[], slotId: string) =>
  slots.find((slot) => slot.slotId === slotId && slot.available)

export type BookOutcome =
  | { ok: true; body: { studentId: string; slotId: string; type: AppointmentType; note: string } }
  | { ok: false; field: 'slotId' | 'type'; message: string }

/**
 * Gönderilecek gövde: saat listedeki alınabilir bir saat, tür rolün seçebildiği türlerden biri
 * olmalı; aksi hâlde istek atılmaz. Mesajlar sunucuyla aynıdır.
 */
export function bookBody(
  values: BookFormValues,
  studentId: string,
  slots: readonly BookableSlot[],
  audience: Exclude<AppointmentAudience, 'teacher'>,
): BookOutcome {
  const slot = selectableSlot(slots, values.slotId)
  if (!slot) return { ok: false, field: 'slotId', message: 'Müsait bir görüşme saati seçin.' }
  const type = appointmentTypes(audience).find((item) => item === values.type)
  if (!type) return { ok: false, field: 'type', message: 'Bu görüşme türünü seçemezsiniz.' }
  return {
    ok: true,
    body: { studentId, slotId: slot.slotId, type, note: values.note.trim() },
  }
}

export type TransitionOutcome =
  { ok: true; body: UpdateAppointmentBody } | { ok: false; message: string }

/** Gerekçe istenen geçişler (DOM-ILT-102). */
export const REASON_TRANSITIONS: readonly AppointmentTransition[] = ['Reddedildi', 'İptal']

/** Durum değişikliği gövdesi; gerekçesiz red ve iptal istek atmadan reddedilir (core şemasıyla). */
export function transitionBody(status: AppointmentTransition, reason: string): TransitionOutcome {
  const text = reason.trim()
  const parsed = updateAppointmentSchema.safeParse({
    status,
    ...(text === '' ? {} : { reason: text }),
  })
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Gerekçeyi yazın.' }
  return { ok: true, body: parsed.data }
}

/** Gerekçe alanının etiketi: işlem hangisiyse gerekçe de odur. */
export const reasonLabel = (actions: readonly string[]) =>
  actions.includes('reject') ? 'Red gerekçesi' : 'İptal gerekçesi'

export const TRANSITION_TOASTS = {
  Onaylandı: 'Randevu onaylandı.',
  Reddedildi: 'Randevu talebi reddedildi.',
  İptal: 'Randevu iptal edildi.',
  'Geri çekildi': 'Randevu talebiniz geri çekildi.',
} as const satisfies Record<AppointmentTransition, string>
