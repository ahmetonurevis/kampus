import type { State } from '../data/seed.ts'
import { appointmentHoldsTime } from './appointment-status.ts'

// Süre verilmeyen kayıtlar 30 dakikalık sayılır.
export type Interval = { date: string; duration?: number }
// Ders, randevu, etüt veya etkinlikle çakışması denetlenen aday kayıt.
export type TutorCandidate = Interval & {
  // Sınıf düzenleme ve öğretmen devri, atanmamış öğretmen/kampüsü de denetime sokar;
  // öğretmensiz okul etkinliği adayı null taşır.
  teacherId: string | null | undefined
  branchId: string | undefined
  room: string
  studentIds?: readonly string[]
}
// Henüz kaydedilmemiş (plan önizlemesindeki) etütler de aynı biçimle denetlenir.
export type TutorBooking = TutorCandidate & {
  id?: string
  status?: string
  studentIds: readonly string[]
}

/** Aday sahibinin göremediği kayıtla çakışmada dönen ileti (DOM-ILT-073, DOM-ILT-103). */
export const HIDDEN_CONFLICT_MESSAGE = 'Bu saat uygun değil.'

export type TutorConflictOptions = {
  /**
   * Çakışan randevuyu isteği yapan görebiliyor mu. Verilmezse bütün randevular görünür sayılır.
   * Göremediği randevuda ayrıntılı ileti yerine genel ileti döner; yoksa başka velinin açtığı
   * gizli görüşmenin varlığı iletiden öğrenilirdi.
   */
  canSeeAppointment?: (appointment: State['appointments'][number]) => boolean
}

export const intervalsOverlap = (first: Interval, second: Interval) =>
  Date.parse(first.date) < Date.parse(second.date) + (second.duration || 30) * 60000 &&
  Date.parse(second.date) < Date.parse(first.date) + (first.duration || 30) * 60000

export function tutorConflict(
  state: State,
  candidate: TutorCandidate,
  additional: readonly TutorBooking[] = [],
  ignoreId = '',
  options: TutorConflictOptions = {},
) {
  const students = new Set(candidate.studentIds || [])
  const room = (value: string | null | undefined) => value?.trim().toLocaleLowerCase('tr')
  for (const lesson of state.schedule.filter(
    (l) => !l.cancelledAt && intervalsOverlap(candidate, l),
  )) {
    const classroom = state.classes.find((c) => c.id === lesson.classId)
    if (lesson.teacherId === candidate.teacherId) return 'Öğretmenin bu saatte dersi var.'
    if (state.students.some((s) => students.has(s.id) && s.classId === lesson.classId))
      return 'Öğrencinin bu saatte dersi var.'
    if (classroom?.branchId === candidate.branchId && room(lesson.room) === room(candidate.room))
      return 'Derslik bu saatte kullanımda.'
  }
  for (const appointment of state.appointments.filter(
    (a) => appointmentHoldsTime(a) && intervalsOverlap(candidate, a),
  )) {
    const teacherBusy = appointment.teacherId === candidate.teacherId
    if (!teacherBusy && !students.has(appointment.studentId)) continue
    if (options.canSeeAppointment && !options.canSeeAppointment(appointment))
      return HIDDEN_CONFLICT_MESSAGE
    return teacherBusy
      ? 'Öğretmenin bu saatte randevusu var.'
      : 'Öğrencinin bu saatte randevusu var.'
  }
  for (const lesson of [...(state.tutorSessions || []), ...additional]) {
    if (lesson.id === ignoreId || lesson.status === 'İptal' || !intervalsOverlap(candidate, lesson))
      continue
    if (lesson.teacherId === candidate.teacherId) return 'Öğretmenin bu saatte başka etüdü var.'
    if (lesson.studentIds.some((id) => students.has(id)))
      return 'Öğrencinin bu saatte başka etüdü var.'
    if (lesson.branchId === candidate.branchId && room(lesson.room) === room(candidate.room))
      return 'Derslik bu saatte başka etüt için ayrılmış.'
  }
  for (const event of (state.schoolEvents || []).filter(
    (e) => e.status !== 'İptal' && e.branchId === candidate.branchId,
  )) {
    const interval = {
      date: event.date,
      duration: (Date.parse(event.endDate) - Date.parse(event.date)) / 60000,
    }
    if (!intervalsOverlap(candidate, interval)) continue
    if (
      state.students.some(
        (s) => students.has(s.id) && (!event.classId || s.classId === event.classId),
      )
    )
      return 'Öğrencinin bu saatte okul etkinliği var.'
    if (room(event.location) === room(candidate.room))
      return 'Derslik bu saatte etkinliğe ayrılmış.'
  }
  return ''
}
