import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { appointmentClosed, type AppointmentStatus } from './appointment-status.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { scopeFor } from './scope.ts'
import { tutorConflict } from './tutor-conflicts.ts'

/**
 * Öğretmen randevusu (docs/domain/iletisim-ve-veli.md DOM-ILT-100…104). Saf işlemler; önce
 * bütün kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts` tablosundadır
 * (`appointment.book`, `appointment.update`), okuma kapsamı `lib/scope.ts` `appointments`.
 *
 * - Talep: veli bağlı çocuğu, öğrenci kendisi için öğrencinin sınıfına ders veren etkin
 *   öğretmenin bir uygunluk saatini (`availability`) seçer; başlangıç ve süre o saatten alınır.
 *   Ders, etüt, etkinlik ve tutan randevularla çakışma `tutorConflict` ile denetlenir (DOM-ILT-101).
 * - Durum: `Bekliyor` → `Onaylandı`/`Reddedildi` (öğretmen), `Geri çekildi` (talep eden);
 *   `Onaylandı` → `İptal` (öğretmen veya talep eden). Son durumlar değişmez; her geçiş kaydın
 *   `history` listesine eklenir, kayıt silinmez (DOM-ILT-102).
 * - Yalnız `Bekliyor` ve `Onaylandı` zamanı tutar; günlük programda yalnız onaylı randevu
 *   görünür (DOM-ILT-104).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`). Not ve gerekçe serbest
 * metindir (kvkk: Ç); loglanmaz, denetim kaydına yalnız alan adı yazılır.
 */

z.config(z.locales.tr())

export type AppointmentOptions = { institutionType?: InstitutionType }

/** Görüşme türleri (Vue `appointmentForm.type`). */
export const APPOINTMENT_TYPES = [
  'Bireysel etüt',
  'Veli görüşmesi',
  'Akademik danışmanlık',
] as const
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number]
/** Talep eden rolün seçebildiği türler; ilki varsayılandır (DOM-ILT-100). */
export const APPOINTMENT_TYPES_BY_ROLE = {
  veli: ['Veli görüşmesi', 'Akademik danışmanlık'],
  ogrenci: ['Bireysel etüt', 'Akademik danışmanlık'],
} as const satisfies Record<'veli' | 'ogrenci', readonly AppointmentType[]>

export const APPOINTMENT_NOTE_MAX_LENGTH = 2000
export const APPOINTMENT_REASON_MAX_LENGTH = 500

const identifier = (message: string) => z.string().trim().min(1, message).max(200)
// kvkk: Ç — talep edenin görüşme konusu; loglanmaz.
const noteText = z
  .string()
  .trim()
  .min(2, 'Görüşme konusunu yazın.')
  .max(
    APPOINTMENT_NOTE_MAX_LENGTH,
    `En fazla ${APPOINTMENT_NOTE_MAX_LENGTH} karakter yazabilirsiniz.`,
  )
// kvkk: Ç — red veya iptal gerekçesi; loglanmaz.
const reasonText = z
  .string()
  .trim()
  .min(2, 'Gerekçeyi yazın.')
  .max(
    APPOINTMENT_REASON_MAX_LENGTH,
    `Gerekçe en fazla ${APPOINTMENT_REASON_MAX_LENGTH} karakter olabilir.`,
  )

export const bookAppointmentSchema = z.strictObject({
  studentId: identifier('Bir öğrenci seçin.'),
  slotId: identifier('Müsait bir görüşme saati seçin.'),
  /** Verilmezse talep edenin varsayılan türü (`APPOINTMENT_TYPES_BY_ROLE`). */
  type: z.enum(APPOINTMENT_TYPES, 'Görüşme türünü seçin.').optional(),
  note: noteText,
})
export type BookAppointmentInput = z.input<typeof bookAppointmentSchema>

/** Durum değişikliğinin hedefleri; `Bekliyor`'a dönüş yoktur. */
export const APPOINTMENT_TRANSITIONS = [
  'Onaylandı',
  'Reddedildi',
  'İptal',
  'Geri çekildi',
] as const satisfies readonly AppointmentStatus[]
export type AppointmentTransition = (typeof APPOINTMENT_TRANSITIONS)[number]
/** Gerekçesi zorunlu geçişler (DOM-ILT-102). */
const REASON_REQUIRED: ReadonlySet<string> = new Set<AppointmentTransition>(['Reddedildi', 'İptal'])

export const updateAppointmentSchema = z
  .strictObject({
    status: z.enum(APPOINTMENT_TRANSITIONS, 'Yeni durumu seçin.'),
    reason: reasonText.optional(),
  })
  .superRefine((data, ctx) => {
    if (REASON_REQUIRED.has(data.status) && data.reason === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          data.status === 'Reddedildi' ? 'Red gerekçesini yazın.' : 'İptal gerekçesini yazın.',
      })
  })
export type UpdateAppointmentInput = z.input<typeof updateAppointmentSchema>

/** İşlemi yapan kişi; API'de kullanıcı kimliği. */
export type AppointmentActor = {
  role: Role
  // kvkk: K
  userId: string
}
export type AppointmentEvent = {
  status: AppointmentStatus
  at: string
  by: AppointmentActor
  // kvkk: Ç — red veya iptal gerekçesi; loglanmaz.
  reason?: string
}
/** Randevu işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type AppointmentFields = {
  /** Dakika; eski kayıtlar taşımaz, çakışma denetimi 30 dakika varsayar. */
  duration?: number
  /** Randevunun bağlandığı uygunluk saati (DOM-ILT-101). */
  slotId?: string
  /** Talebi açan kişi (DOM-ILT-100, -103); eski kayıtta yoktur. */
  requestedBy?: AppointmentActor
  createdAt?: string
  updatedAt?: string
  /** Durum geçmişi; yalnız eklenir (DOM-ILT-102). */
  history?: AppointmentEvent[]
}

type AppointmentRecord = State['appointments'][number]
type StudentRecord = State['students'][number]

const actorOf = (by: Participant): AppointmentActor => ({ role: by.role, userId: by.userId })
const notFound = () =>
  new DomainError('appointment_not_found', 'Randevu bulunamadı.', { kind: 'not_found' })

function requireActiveStudent(state: State, studentId: string): StudentRecord {
  const student = state.students.find((s) => s.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError(
      'student_inactive',
      'Kaydı pasif olan öğrenci için randevu talep edilemez.',
      { path: ['studentId'] },
    )
  return student
}

/**
 * Randevu adayının çakışma denetimi; kampüs öğrencinin sınıfından gelir (etkinlik denetimi).
 * Çakışan randevuyu isteği yapan göremiyorsa ileti genel kalır: başka velinin açtığı görüşme
 * ya da başka öğretmenin randevusu iletiden öğrenilmez (DOM-ILT-073, DOM-ILT-103).
 */
function conflictOf(
  state: State,
  by: Participant,
  candidate: { teacherId: string; studentId: string; date: string; duration?: number | undefined },
  options: AppointmentOptions,
): string {
  const classroom = state.classes.find(
    (c) => c.id === state.students.find((s) => s.id === candidate.studentId)?.classId,
  )
  const scope = scopeFor(state, by, options)
  return tutorConflict(
    state,
    {
      teacherId: candidate.teacherId,
      date: candidate.date,
      ...(candidate.duration === undefined ? {} : { duration: candidate.duration }),
      branchId: classroom?.branchId,
      room: '',
      studentIds: [candidate.studentId],
    },
    [],
    '',
    { canSeeAppointment: (appointment) => scope.canRead('appointments', appointment) },
  )
}

/**
 * Veli bağlı çocuğu, öğrenci kendisi için randevu talep eder (DOM-ILT-100, -101). Talep
 * `Bekliyor` durumunda açılır. Mükerrer gönderim istek anahtarıyla önlenir (API
 * `Idempotency-Key` zorunlu); aynı saati iki talep isterse ikincisi çakışma alır.
 */
export function bookAppointment(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: AppointmentOptions = {},
): AppointmentRecord {
  const data = bookAppointmentSchema.parse(input)
  requireAuthorized(by, 'appointment.book', { studentId: data.studentId }, state, options)
  const student = requireActiveStudent(state, data.studentId)
  const role = by.role === 'veli' ? 'veli' : 'ogrenci'
  const allowedTypes: readonly AppointmentType[] = APPOINTMENT_TYPES_BY_ROLE[role]
  const type = data.type ?? allowedTypes[0] ?? 'Akademik danışmanlık'
  if (!allowedTypes.includes(type))
    throw new DomainError('appointment_type_invalid', 'Bu görüşme türünü seçemezsiniz.', {
      path: ['type'],
    })
  // Saat yoksa, başka öğretmenin ya da öğrenciye ders vermeyen öğretmenin saatiyse aynı yanıt:
  // öğrenci ve veli uygunluk listesini yalnız kendi öğretmenleri için görür.
  const slot = state.availability.find((s) => s.id === data.slotId)
  const teacher = slot && state.teachers.find((t) => t.id === slot.teacherId)
  const teaches =
    !!teacher &&
    state.assignments.some((a) => a.classId === student.classId && a.teacherId === teacher.id)
  if (!slot || !teacher || !teaches || teacher.isActive === false || teacher.deletedAt)
    throw new DomainError('appointment_slot_unavailable', 'Müsait bir görüşme saati seçin.', {
      path: ['slotId'],
    })
  if (Date.parse(slot.date) <= Date.parse(now))
    throw new DomainError('appointment_in_past', 'Gelecekteki bir görüşme saati seçin.', {
      path: ['slotId'],
    })
  const reason = conflictOf(
    state,
    by,
    { teacherId: teacher.id, studentId: student.id, date: slot.date, duration: slot.duration },
    options,
  )
  if (reason)
    throw new DomainError('appointment_conflict', reason, { kind: 'conflict', path: ['slotId'] })
  const requester = actorOf(by)
  const appointment: AppointmentRecord = {
    id: makeId('apt'),
    studentId: student.id,
    teacherId: teacher.id,
    date: slot.date,
    duration: slot.duration,
    slotId: slot.id,
    type,
    note: data.note,
    status: 'Bekliyor',
    requestedBy: requester,
    createdAt: now,
    history: [{ status: 'Bekliyor', at: now, by: requester }],
  }
  // TODO(notifications): öğretmene uygulama içi bildirim (DOM-ILT-020).
  state.appointments.unshift(appointment)
  return appointment
}

/**
 * Aktörün görebildiği randevu; görmediği veya olmayan randevu aynı 404'tür (DOM-ILT-103).
 * `updateAppointment` ilk iş bunu çağırır; API sürüm farkını ancak bundan sonra bildirir.
 */
export function requireVisibleAppointment(
  state: State,
  by: Participant,
  appointmentId: string,
  options: AppointmentOptions = {},
): AppointmentRecord {
  requireAuthorized(by, 'appointment.update', {}, state, options)
  const appointment = state.appointments.find((a) => a.id === appointmentId)
  if (!appointment) throw notFound()
  if (!scopeFor(state, by, options).canRead('appointments', appointment)) throw notFound()
  return appointment
}

/**
 * Randevunun durumunu değiştirir (DOM-ILT-102): öğretmen onaylar, gerekçeyle reddeder veya
 * iptal eder; talep eden onaydan önce geri çeker, onaydan sonra gerekçeyle iptal eder.
 */
export function updateAppointment(
  state: State,
  by: Participant,
  appointmentId: string,
  input: unknown,
  now: string,
  options: AppointmentOptions = {},
): AppointmentRecord {
  const data = updateAppointmentSchema.parse(input)
  const appointment = requireVisibleAppointment(state, by, appointmentId, options)
  const current = appointment.status
  if (appointmentClosed(appointment))
    throw new DomainError('appointment_closed', 'Sonuçlanmış randevu değiştirilemez.', {
      kind: 'conflict',
      path: ['status'],
    })
  // Görünürlük öğretmende kendi randevusudur; talep eden kişi kullanıcı kimliğiyle eşlenir.
  const isTeacher = by.role === 'ogretmen'
  const isRequester =
    appointment.requestedBy !== undefined && appointment.requestedBy.userId === by.userId
  const forbidden = (code: string, message: string) =>
    new DomainError(code, message, { kind: 'forbidden' })
  const transitionInvalid = (message: string) =>
    new DomainError('appointment_transition_invalid', message, { path: ['status'] })
  const starts = Date.parse(appointment.date)
  const future = () => {
    if (starts <= Date.parse(now))
      throw new DomainError('appointment_in_past', 'Başlamış veya geçmiş randevu değiştirilemez.', {
        path: ['status'],
      })
  }
  switch (data.status) {
    case 'Onaylandı':
    case 'Reddedildi': {
      if (!isTeacher)
        throw forbidden(
          'appointment_teacher_only',
          'Randevuyu yalnızca ilgili öğretmen onaylayabilir veya reddedebilir.',
        )
      if (current !== 'Bekliyor')
        throw transitionInvalid(
          'Onaylanmış randevu yeniden değerlendirilemez; gerekirse iptal edin.',
        )
      if (data.status === 'Onaylandı') {
        future()
        requireActiveStudent(state, appointment.studentId)
        const reason = conflictOf(
          { ...state, appointments: state.appointments.filter((a) => a.id !== appointment.id) },
          by,
          appointment,
          options,
        )
        if (reason)
          throw new DomainError('appointment_conflict', reason, {
            kind: 'conflict',
            path: ['status'],
          })
      }
      break
    }
    case 'Geri çekildi':
      if (!isRequester)
        throw forbidden(
          'appointment_requester_only',
          'Talebi yalnızca talep eden kişi geri çekebilir.',
        )
      if (current !== 'Bekliyor')
        throw transitionInvalid('Onaylanmış randevu geri çekilemez; gerekçeyle iptal edin.')
      break
    case 'İptal':
      if (!isTeacher && !isRequester)
        throw forbidden(
          'appointment_cancel_forbidden',
          'Randevuyu yalnızca ilgili öğretmen veya talep eden kişi iptal edebilir.',
        )
      if (current !== 'Onaylandı')
        throw transitionInvalid(
          'Yalnızca onaylanmış randevu iptal edilir; bekleyen talep reddedilir veya geri çekilir.',
        )
      future()
      break
    default:
      return data.status satisfies never
  }
  const event: AppointmentEvent = {
    status: data.status,
    at: now,
    by: actorOf(by),
    ...(data.reason === undefined ? {} : { reason: data.reason }),
  }
  Object.assign(appointment, {
    status: data.status,
    updatedAt: now,
    history: [...(appointment.history ?? []), event],
  })
  // TODO(notifications): karşı tarafa uygulama içi bildirim (DOM-ILT-020).
  return appointment
}
