// Öğretmenin Randevular sayfasındaki "Müsaitlik saatlerim" satırları. Saf işlevdir: koleksiyon
// durumu girer, tablo satırı çıkar. Saat ekleme/kaldırma kuralı ve yetkisi etüt komutlarındadır
// (`runAssessment` slot / slot-remove); burada yalnız arayüzün hangi satırda "Kaldır" göstereceği
// türetilir (DOM-ILT-101: bekleyen ya da onaylı randevuya bağlı saat kaldırılamaz).
import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { appointmentHoldsTime } from '@kampus/school-core/lib/appointment-status.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { sessionTeacherId } from '@kampus/school-core/lib/scope.ts'
import { intervalsOverlap } from '@kampus/school-core/lib/tutor-conflicts.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'

/** Okunan koleksiyonlar; ilki ana koleksiyondur. Randevular "Dolu" durumunu belirler. */
export const TEACHER_SLOT_SOURCES = [
  'availability',
  'teachers',
  'appointments',
] as const satisfies readonly CollectionName[]

export type TeacherSlotRow = {
  id: string
  /** Başlangıç, ISO 8601 UTC (sıralama anahtarı). */
  startsAt: string
  /** "Pzt, 3 Kas 2026". */
  day: string
  /** "14:00". */
  time: string
  duration: number
  /** Saate bağlı bekleyen ya da onaylı randevu var: saat Dolu, kaldırılamaz. */
  booked: boolean
  /** "Dolu" ya da "Müsait" (arama ve sıralama değeri). */
  status: 'Dolu' | 'Müsait'
}

/**
 * Oturumdaki öğretmenin gelecekteki saatleri (başlangıca göre artan). Sunucu zaten yalnız kendi
 * saatlerini döndürür; yine de `teacherId` ile süzülür. Saati bilinmeyen eski randevu, aynı
 * öğretmenin bu aralıktaki randevusu sayılır; sunucunun kaldırma kontrolüyle aynıdır.
 */
export function teacherSlotRows(state: State, session: Session, now: string): TeacherSlotRow[] {
  const own = sessionTeacherId(state, session)
  if (own === undefined) return []
  const held = state.appointments.filter(appointmentHoldsTime)
  return state.availability
    .filter((slot) => slot.teacherId === own && Date.parse(slot.date) > Date.parse(now))
    .map((slot) => {
      const booked = held.some(
        (item) =>
          item.slotId === slot.id ||
          (item.slotId === undefined &&
            item.teacherId === slot.teacherId &&
            intervalsOverlap(item, slot)),
      )
      return {
        id: slot.id,
        startsAt: slot.date,
        day: dateLabel(slot.date, { weekday: 'short', year: 'numeric' }),
        time: timeLabel(slot.date),
        duration: slot.duration,
        booked,
        status: booked ? ('Dolu' as const) : ('Müsait' as const),
      }
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
}

/** Sağ panelde forma bağlanan öğretmen: yalnız oturumdaki öğretmen (seçim gösterilmez). */
export function ownSlotTeacher(
  state: State,
  session: Session,
): { id: string; name: string } | undefined {
  const own = sessionTeacherId(state, session)
  const teacher = state.teachers.find((item) => item.id === own && item.isActive)
  return teacher ? { id: teacher.id, name: teacher.name } : undefined
}
