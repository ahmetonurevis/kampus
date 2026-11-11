// Öğrenci "Etüt Randevusu" ekranının saf modeli (IST-124; DOM-ILT-100, DOM-ILT-102, DOM-ILT-103,
// DOM-ILT-105). Liste satırı, durum sekmeleri, alınabilir saatler, talep ve iptal/geri çekme
// doğrulaması ve hata metinleri burada; ekran (`screens/StudentAppointments.tsx`,
// `screens/appointment-book.tsx`, `screens/appointment-sheet.tsx`) yalnız çizer. Satır, saat
// gruplama ve gövde hesapları web ile ortaktır (`@kampus/react-shared/appointment-model.ts`,
// `appointment-form-model.ts`).
//
// Gün ve saat Europe/Istanbul gösterilir; "bugün" cihaz saatinden değil sunucudan gelir
// (`/academic-years/current` `date`). Randevu işlemlerinin zamana bağlı kararı (onaylı randevunun
// iptali yalnız başlamamışta) bu günün başlangıcına göre görünür; kesin karar sunucudadır ve
// başlamış randevunun iptali orada Türkçe mesajla reddedilir.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { BookableSlot } from '@kampus/react-shared/appointment-slots.ts'
import {
  REASON_TRANSITIONS,
  TRANSITION_TOASTS,
  bookBody,
  groupSlots,
  reasonLabel,
  selectableSlot,
  transitionBody,
  type BookFormValues,
  type SlotGroup,
} from '@kampus/react-shared/appointment-form-model.ts'
import {
  appointmentActions,
  appointmentLookups,
  appointmentRow,
  orderAppointments,
  type AppointmentAction,
  type AppointmentLookups,
  type AppointmentRow,
} from '@kampus/react-shared/appointment-model.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  APPOINTMENT_MESSAGES,
  type UpdateAppointmentBody,
} from '@kampus/react-shared/use-appointment-commands.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { AppointmentTransition } from '@kampus/school-core/lib/appointments.ts'
import { bookAppointmentSchema } from '@kampus/school-core/lib/appointments.ts'
import { commandFailure, type FieldErrors } from './command-failure.ts'
import { matchesSearch } from './presentation.ts'

export { appointmentLookups, groupSlots, selectableSlot, REASON_TRANSITIONS, TRANSITION_TOASTS }
export type { AppointmentLookups, AppointmentRow, SlotGroup }

type AppointmentItem = CollectionRow<State['appointments'][number]>

// --- Sunucu günü -------------------------------------------------------------------------------

/**
 * Sunucu gününün (Europe/Istanbul, `YYYY-AA-GG`) ilk anı, ISO UTC. İstanbul yıl boyu UTC+3'tür
 * (yaz saati yok). Gün henüz gelmediyse `null`: zamana bağlı eylemler (iptal) o zamana kadar
 * gösterilmez, tahmin edilmez.
 */
export function serverDayStart(today: string | null): string | null {
  if (today === null || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const start = new Date(`${today}T00:00:00+03:00`)
  return Number.isNaN(start.getTime()) ? null : start.toISOString()
}

// --- Liste ---------------------------------------------------------------------------------

export type AppointmentGroup = 'pending' | 'approved' | 'closed'

/** Süzgeç değeri: boş metin "tümü" demektir (`list-state.ts`). */
export const APPOINTMENT_GROUP_OPTIONS = [
  { value: '', label: 'Tümü' },
  { value: 'pending', label: 'Bekleyen' },
  { value: 'approved', label: 'Onaylı' },
  { value: 'closed', label: 'Kapanan' },
] as const satisfies readonly { value: '' | AppointmentGroup; label: string }[]

export const isAppointmentGroup = (value: string): value is AppointmentGroup =>
  value === 'pending' || value === 'approved' || value === 'closed'

export function appointmentGroup(row: Pick<AppointmentRow, 'status'>): AppointmentGroup {
  if (row.status === 'Bekliyor') return 'pending'
  if (row.status === 'Onaylandı') return 'approved'
  return 'closed'
}

/**
 * Öğrencinin satırları: bekleyen, yaklaşan onaylı, sonra sonuçlananlar. Sıra ve eylemler sunucu
 * gününe göre kurulur; gün yoksa sıra kayıt sırasında kalır ve yalnız geri çekme sunulur.
 */
export function studentAppointmentRows(
  items: readonly AppointmentItem[],
  lookups: AppointmentLookups,
  viewerId: string,
  today: string | null,
): AppointmentRow[] {
  const now = serverDayStart(today)
  const rows = items.map((item) => appointmentRow(item, lookups, 'student', viewerId, now ?? ''))
  if (now === null)
    return rows.map((row) => ({
      ...row,
      actions: row.actions.filter((action) => action === 'withdraw'),
    }))
  return orderAppointments(rows, now)
}

/** Satırın bu anda sunulacak eylemleri; sunucu aynı kuralı yeniden denetler (DOM-ILT-102). */
export function studentActions(row: AppointmentRow, today: string | null): AppointmentAction[] {
  const now = serverDayStart(today)
  const actions = appointmentActions(row, 'student', now ?? row.startsAt)
  return now === null ? actions.filter((action) => action === 'withdraw') : actions
}

export function appointmentGroupCounts(
  rows: readonly Pick<AppointmentRow, 'status'>[],
): Record<AppointmentGroup, number> {
  const counts: Record<AppointmentGroup, number> = { pending: 0, approved: 0, closed: 0 }
  for (const row of rows) counts[appointmentGroup(row)] += 1
  return counts
}

/** Sekme ve aramaya uyan satırlar (arama: öğretmen, tür, konu, tarih, durum). */
export function visibleAppointmentRows(
  rows: readonly AppointmentRow[],
  filter: string,
  search: string,
): AppointmentRow[] {
  return rows.filter(
    (row) =>
      (!isAppointmentGroup(filter) || appointmentGroup(row) === filter) &&
      matchesSearch([row.counterpart, row.type, row.note, row.when, row.status], search),
  )
}

export function appointmentEmptyText(filter: string): { title: string; text: string } {
  if (filter === 'pending')
    return { title: 'Bekleyen talep yok', text: 'Öğretmenin onayını bekleyen randevun yok.' }
  if (filter === 'approved')
    return { title: 'Onaylı randevu yok', text: 'Onaylanan randevuların burada görünür.' }
  if (filter === 'closed')
    return { title: 'Kapanan randevu yok', text: 'Reddedilen veya iptal edilenler burada görünür.' }
  return {
    title: 'Henüz randevun yok',
    text: 'Öğretmenlerinin müsait saatlerinden "Randevu talep et" ile birebir görüşme isteyebilirsin.',
  }
}

export const appointmentBadgeTone = (status: string): 'green' | 'amber' | 'red' | 'primary' =>
  status === 'Onaylandı'
    ? 'green'
    : status === 'Bekliyor'
      ? 'amber'
      : status === 'Reddedildi'
        ? 'red'
        : 'primary'

/** Yenileme hatası veri varken yerinde (satır içi), tam ekran hata yalnız hiç veri yokken. */
export function appointmentErrorView(error: unknown, hasData: boolean): 'none' | 'inline' | 'full' {
  if (!error) return 'none'
  return hasData ? 'inline' : 'full'
}

// --- Alınabilir saatler ----------------------------------------------------------------------

/** Öğretmen süzgeci "tümü" değeri; boş metin. */
export const ALL_TEACHERS = ''

/** Saat listesindeki öğretmenler (ad sıralı, tekrarsız). */
export function slotTeachers(groups: readonly SlotGroup[]): string[] {
  const names = new Set<string>()
  for (const group of groups) for (const slot of group.slots) names.add(slot.teacher)
  return [...names].sort((a, b) => a.localeCompare(b, 'tr'))
}

/** Seçili öğretmenin saatleri; boş gün grupları düşer. Süzgeç değeri bilinmiyorsa tümü gösterilir. */
export function filterSlotGroups(groups: readonly SlotGroup[], teacher: string): SlotGroup[] {
  if (teacher === ALL_TEACHERS || !slotTeachers(groups).includes(teacher)) return [...groups]
  return groups
    .map((group) => ({ ...group, slots: group.slots.filter((slot) => slot.teacher === teacher) }))
    .filter((group) => group.slots.length > 0)
}

/** Seçili saat hâlâ alınabilir mi; dolan ya da listeden düşen saatin seçimi kalkar. */
export const stillSelectable = (slots: readonly BookableSlot[], slotId: string): string =>
  selectableSlot(slots, slotId)?.slotId ?? ''

// --- Talep formu -----------------------------------------------------------------------------

export type BookField = 'slotId' | 'type' | 'note'
export type BookErrors = Partial<Record<BookField, string>>

export type BookCheck =
  | { ok: true; body: Extract<ReturnType<typeof bookBody>, { ok: true }>['body'] }
  | { ok: false; errors: BookErrors }

/**
 * Gönderimden önce denetim: saat listedeki alınabilir bir saat, tür öğrencinin seçebildiği türlerden
 * biri, konu core şemasının sınırlarında (`bookAppointmentSchema`). Alan alan, tek seferde döner;
 * karar sunucudadır.
 */
export function checkBook(
  values: BookFormValues,
  studentId: string,
  slots: readonly BookableSlot[],
): BookCheck {
  const errors: BookErrors = {}
  const result = bookBody(values, studentId, slots, 'student')
  if (!result.ok) errors[result.field] = result.message
  const note = bookAppointmentSchema.shape.note.safeParse(values.note)
  if (!note.success) errors.note = note.error.issues[0]?.message ?? 'Görüşme konusunu yazın.'
  if (!result.ok || Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, body: result.body }
}

const BOOK_FIELDS: readonly string[] = ['slotId', 'type', 'note']

export type CommandView<TField extends string> = {
  errors: Partial<Record<TField, string>>
  message: string | null
  retryable: boolean
}

function view<TField extends string>(
  error: ApiError,
  collected: FieldErrors,
  known: readonly string[],
): CommandView<TField> {
  const failure = commandFailure(error, APPOINTMENT_MESSAGES, collected)
  const errors: Partial<Record<TField, string>> = {}
  const rest: string[] = []
  for (const [name, message] of Object.entries(failure.fields)) {
    if (known.includes(name)) errors[name as TField] = message
    else rest.push(message)
  }
  const message = [failure.message, ...rest].filter(Boolean).join(' ')
  return { errors, message: message === '' ? null : message, retryable: failure.retryable }
}

/** Talep hatası: çakışma (dolu saat) `slotId` alanında, geri kalanı genel mesajdır. */
export const bookFailure = (error: ApiError, collected: FieldErrors) =>
  view<BookField>(error, collected, BOOK_FIELDS)

// --- İptal ve geri çekme -----------------------------------------------------------------------

export type ActionField = 'reason'

/** İptal gerekçesi alanının etiketi ve geri çekme/iptal metinleri. */
export const ACTION_TEXTS = {
  withdraw: {
    title: 'Talebi geri çek',
    description:
      'Talep onaylanmadan geri çekilirse öğretmenin bekleyen taleplerinden çıkar ve saat yeniden alınabilir olur. Bu işlem geri alınamaz.',
    confirm: 'Evet, geri çek',
    done: TRANSITION_TOASTS['Geri çekildi'],
  },
  cancel: {
    title: 'Randevuyu iptal et',
    description:
      'İptal gerekçesi randevu geçmişine yazılır. Başlamış randevu iptal edilemez; saat yeniden alınabilir olur.',
    confirm: 'Randevuyu iptal et',
    done: TRANSITION_TOASTS.İptal,
  },
} as const satisfies Record<
  'withdraw' | 'cancel',
  { title: string; description: string; confirm: string; done: string }
>

export const cancelReasonLabel = (): string => reasonLabel(['cancel'])

export type ActionCheck =
  | { ok: true; status: AppointmentTransition; body: UpdateAppointmentBody }
  | { ok: false; message: string }

/** Eylemin gövdesi; gerekçesiz iptal istek atmadan reddedilir (core `updateAppointmentSchema`). */
export function checkAction(action: 'withdraw' | 'cancel', reason: string): ActionCheck {
  const status: AppointmentTransition = action === 'cancel' ? 'İptal' : 'Geri çekildi'
  const outcome = transitionBody(status, REASON_TRANSITIONS.includes(status) ? reason : '')
  if (!outcome.ok) return { ok: false, message: outcome.message }
  return { ok: true, status, body: outcome.body }
}

/** İptal/geri çekme hatası: gerekçe alanında, çakışma ve geçmiş saat genel mesajdır. */
export const actionFailure = (error: ApiError, collected: FieldErrors) =>
  view<ActionField>(error, collected, ['reason'])
