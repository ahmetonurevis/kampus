// Randevu ekranlarının (öğrenci `randevu-talep`, veli Randevular sekmesi, öğretmen `randevular`)
// satır hesapları. Saf işlevlerdir: API satırı girer, tablo ve panel satırı çıkar. Durum geçişi
// kuralı core'dadır (`lib/appointments.ts` `updateAppointment`); burada yalnız arayüzün hangi
// düğmeyi göstereceği türetilir. Karar yine sunucudadır (DOM-ILT-102, DOM-ILT-103).
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  APPOINTMENT_STATUSES,
  appointmentClosed,
  appointmentHoldsTime,
  scheduledAppointments,
  type AppointmentStatus,
} from '@kampus/school-core/lib/appointment-status.ts'
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPES_BY_ROLE,
} from '@kampus/school-core/lib/appointments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'

/** Ekranı kullanan taraf; veli ve öğrenci aynı ekranı farklı tür seçenekleriyle görür. */
export type AppointmentAudience = 'student' | 'parent' | 'teacher'
export type AppointmentAction = 'approve' | 'reject' | 'cancel' | 'withdraw'

export type AppointmentLookups = { teachers: ReadonlyMap<string, string> }

const ROLE_LABELS: Readonly<Record<string, string>> = {
  yonetici: 'Yönetici',
  onburo: 'Ön büro',
  ogretmen: 'Öğretmen',
  ogrenci: 'Öğrenci',
  veli: 'Veli',
}

/** Durum geçmişindeki satırın başlığı; ilk kayıt talebin açılışıdır. */
const EVENT_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  Bekliyor: 'Talep açıldı',
  Onaylandı: 'Onaylandı',
  Reddedildi: 'Reddedildi',
  İptal: 'İptal edildi',
  'Geri çekildi': 'Geri çekildi',
}

export const STATUS_TONES = {
  Bekliyor: 'amber',
  Onaylandı: 'green',
  Reddedildi: 'red',
  İptal: 'gray',
  'Geri çekildi': 'gray',
} as const satisfies Record<AppointmentStatus, BadgeTone>

export type HistoryRow = {
  key: string
  label: string
  /** "31 Eki 2026 14:05". */
  stamp: string
  /** İşlemi yapanın rolü; kişi adı gösterilmez. */
  by: string
  reason: string
}

export type AppointmentRow = {
  id: string
  /** `If-Match` için okunan sürüm. */
  version: number
  studentId: string
  student: string
  teacherId: string
  teacher: string
  /** Karşı taraf: öğretmende öğrenci, öğrenci ve velide öğretmen. */
  counterpart: string
  type: string
  note: string
  status: string
  /** Başlangıç, ISO 8601 UTC (sıralama anahtarı). */
  startsAt: string
  /** "31 Eki 2026 13:00". */
  when: string
  /** Dakika; eski kayıtlar süre taşımaz. */
  duration: number | null
  /** Zamanı tutuyor (`Bekliyor`, `Onaylandı`). */
  open: boolean
  closed: boolean
  /** Talebi görüntüleyen kişi açtı. Açanı bilinmeyen eski kayıtta hiç doğru değildir. */
  mine: boolean
  actions: AppointmentAction[]
  history: HistoryRow[]
}

/** "31 Eki 2026 14:05" biçiminde gün ve saat (Europe/Istanbul). */
export const appointmentStamp = (iso: string) =>
  `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

const isStatus = (value: string): value is AppointmentStatus =>
  (APPOINTMENT_STATUSES as readonly string[]).includes(value)

/**
 * Durumdaki geçerli işlemler (DOM-ILT-102). Öğretmen bekleyen talebi onaylar (saat gelecekte
 * olmalı) ya da reddeder; talep eden onaydan önce geri çeker. Onaylı ve başlamamış randevuyu
 * öğretmen ya da talep eden iptal eder. Yönetici ve ön büro randevuyu değiştirmez
 * (`TODO(randevu-yonetici-iptal)`). Sunucu aynı kuralı yeniden denetler. Saate bağlıdır:
 * `AppointmentRow.actions` satır kurulduğu andaki değerdir; açık duran ekranlar düğmeleri
 * her çizimde güncel `now` ile buradan hesaplar.
 */
export function appointmentActions(
  row: { status: string; startsAt: string; mine: boolean },
  audience: AppointmentAudience,
  now: string,
): AppointmentAction[] {
  const future = Date.parse(row.startsAt) > Date.parse(now)
  if (row.status === 'Bekliyor') {
    if (audience === 'teacher') return future ? ['approve', 'reject'] : ['reject']
    return row.mine ? ['withdraw'] : []
  }
  if (row.status === 'Onaylandı' && future && (audience === 'teacher' || row.mine))
    return ['cancel']
  return []
}

/**
 * Liste süzgeçleri: durum ve tür. Seçenekler satırlardan türetilmez, sabittir; böylece süzgeç
 * henüz hiç satırı olmayan bir durumu (ör. "Reddedildi") da seçtirir ve boş sonuç söyler.
 * Öğrenci yalnız kendi seçebildiği türleri (`APPOINTMENT_TYPES_BY_ROLE`), öğretmen ve veli
 * öteki tarafın açtığı türleri de görür.
 */
export function appointmentFilters(audience: AppointmentAudience): FilterField[] {
  const types: readonly string[] =
    audience === 'student' ? APPOINTMENT_TYPES_BY_ROLE.ogrenci : APPOINTMENT_TYPES
  return [
    {
      key: 'status',
      label: 'Durum',
      options: APPOINTMENT_STATUSES.map((value) => ({ value, label: value })),
    },
    { key: 'type', label: 'Tür', options: types.map((value) => ({ value, label: value })) },
  ]
}

export function appointmentLookups(
  teachers: ReadonlyArray<{ id: string; record: { name: string } }>,
): AppointmentLookups {
  return { teachers: new Map(teachers.map((item) => [item.id, item.record.name])) }
}

export function appointmentRow(
  item: CoreRow<'appointments'>,
  lookups: AppointmentLookups,
  audience: AppointmentAudience,
  viewerId: string,
  now: string,
): AppointmentRow {
  const record = item.record
  const student = item.joined?.studentName ?? ''
  // TODO(randevu-eski-ogretmen-adi): arşivdeki öğretmen kapsamlı `teachers` listesinde yoktur;
  // ad sunucuda satıra bağlanınca (`joined`) buradan okunur.
  const teacher = lookups.teachers.get(record.teacherId) ?? '—'
  const status = record.status
  const mine = record.requestedBy !== undefined && record.requestedBy.userId === viewerId
  const partial = { status, startsAt: record.date, mine }
  return {
    id: item.id,
    version: item.version,
    studentId: record.studentId,
    student,
    teacherId: record.teacherId,
    teacher,
    counterpart: audience === 'teacher' ? student || '—' : teacher,
    type: record.type,
    note: record.note,
    status,
    startsAt: record.date,
    when: appointmentStamp(record.date),
    duration: record.duration ?? null,
    open: appointmentHoldsTime(record),
    closed: appointmentClosed(record),
    mine,
    actions: appointmentActions(partial, audience, now),
    history: (record.history ?? []).map((event, index) => ({
      key: `${item.id}-${index}`,
      label: isStatus(event.status) ? EVENT_LABELS[event.status] : event.status,
      stamp: appointmentStamp(event.at),
      by: ROLE_LABELS[event.by.role] ?? event.by.role,
      reason: event.reason ?? '',
    })),
  }
}

/**
 * Sıra: bekleyen talepler, yaklaşan onaylılar, sonra sonuçlananlar. İlk ikisi yaklaşan önce,
 * sonuncusu yeniden eskiye. Saati geçmiş onaylı randevu artık yaklaşan değil, yapılmış görüşmedir:
 * sonuçlananlar grubuna girer (`now` ile).
 */
export function orderAppointments(rows: readonly AppointmentRow[], now: string): AppointmentRow[] {
  const rank = (row: AppointmentRow) =>
    row.status === 'Bekliyor' ? 0 : row.open && Date.parse(row.startsAt) > Date.parse(now) ? 1 : 2
  const start = (row: AppointmentRow) => Date.parse(row.startsAt)
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 2 ? start(b) - start(a) : start(a) - start(b)),
  )
}

/**
 * Programda görünen randevular: yalnız onaylanmış ve başlamamış olanlar, en yakın önce
 * (DOM-ILT-104). Bekleyen talep henüz yapılacak görüşme değildir; red, geri çekme ve iptal
 * programdan düşer.
 */
export function upcomingSchedule(
  rows: readonly AppointmentRow[],
  now: string,
  limit = 5,
): AppointmentRow[] {
  return scheduledAppointments(rows)
    .filter((row) => Date.parse(row.startsAt) > Date.parse(now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, limit)
}

/**
 * Veli panelinde açılan randevu seçili çocuğun değilse gösterilmez: adres (`?cocuk=s2&randevu=…`)
 * başka çocuğun randevusunu taşıyabilir. Öğrenci ve öğretmende çocuk kavramı yoktur.
 */
export const outsideChildScope = (
  row: Pick<AppointmentRow, 'studentId'>,
  audience: AppointmentAudience,
  childId: string | undefined,
): boolean => audience === 'parent' && childId !== undefined && row.studentId !== childId

export const pendingCount = (rows: readonly AppointmentRow[]) =>
  rows.filter((row) => row.status === 'Bekliyor').length
