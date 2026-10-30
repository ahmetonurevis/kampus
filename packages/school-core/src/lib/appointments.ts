import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { appointmentClosed, type AppointmentStatus } from './appointment-status.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { scopeFor, type Scope } from './scope.ts'
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
type TeacherRecord = State['teachers'][number]
type SlotRecord = State['availability'][number]

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
 * Kapsam çağırandan gelir; saat listesi (`bookableSlots`) onu bir kez kurar.
 */
function conflictOf(
  state: State,
  scope: Scope,
  candidate: { teacherId: string; studentId: string; date: string; duration?: number | undefined },
): string {
  const classroom = state.classes.find(
    (c) => c.id === state.students.find((s) => s.id === candidate.studentId)?.classId,
  )
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

type SlotCheck =
  | { slot: SlotRecord; teacher: TeacherRecord; error?: never }
  | { error: DomainError; slot?: never; teacher?: never }

/**
 * Uygunluk saati bu öğrenci için alınabilir mi (DOM-ILT-101). Talep (`bookAppointment`) ve saat
 * listesi (`bookableSlots`, DOM-ILT-105) aynı denetimi kullanır; liste kuralı kopyalamaz.
 * Saat yoksa, başka öğretmenin ya da öğrenciye ders vermeyen öğretmenin saatiyse aynı ret:
 * öğrenci ve veli uygunluk listesini yalnız kendi öğretmenleri için görür.
 */
function checkSlot(
  state: State,
  scope: Scope,
  student: StudentRecord,
  slot: SlotRecord | undefined,
  now: string,
): SlotCheck {
  const teacher = slot && state.teachers.find((t) => t.id === slot.teacherId)
  const teaches =
    !!teacher &&
    state.assignments.some((a) => a.classId === student.classId && a.teacherId === teacher.id)
  if (!slot || !teacher || !teaches || teacher.isActive === false || teacher.deletedAt)
    return {
      error: new DomainError('appointment_slot_unavailable', 'Müsait bir görüşme saati seçin.', {
        path: ['slotId'],
      }),
    }
  if (Date.parse(slot.date) <= Date.parse(now))
    return {
      error: new DomainError('appointment_in_past', 'Gelecekteki bir görüşme saati seçin.', {
        path: ['slotId'],
      }),
    }
  const reason = conflictOf(state, scope, {
    teacherId: teacher.id,
    studentId: student.id,
    date: slot.date,
    duration: slot.duration,
  })
  if (reason)
    return {
      error: new DomainError('appointment_conflict', reason, {
        kind: 'conflict',
        path: ['slotId'],
      }),
    }
  return { slot, teacher }
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
  // TODO(randevu-modul): `tutoring` kapalı, `communication` açıkken uygunluk saati eklenemez ve
  // kaldırılamaz (saat komutları `tutoring`'dir) ama var olan saatlerden talep açılabilir.
  // Ürün kararı gerekir (DOM-ILT-101 notu).
  const check = checkSlot(
    state,
    scopeFor(state, by, options),
    student,
    state.availability.find((s) => s.id === data.slotId),
    now,
  )
  if (check.error) throw check.error
  const { slot, teacher } = check
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
          scopeFor(state, by, options),
          appointment,
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

// --- Alınabilir saatler (DOM-ILT-105) ----------------------------------------------------------

/** Aralık verilmezse bugünden (`now`) itibaren bu kadar gün okunur. */
export const BOOKABLE_SLOTS_DEFAULT_DAYS = 14
/** Bir istekte okunabilen en uzun aralık. */
export const BOOKABLE_SLOTS_MAX_DAYS = 28
const DAY_MS = 86_400_000

const instant = z.iso.datetime({ offset: true, error: 'Geçerli bir tarih ve saat girin.' })

/**
 * Saat listesi sorgusu: öğrenci (velide seçili çocuk, öğrencide kendisi) ve isteğe bağlı aralık
 * (ISO 8601). `from` yoksa `now`, `to` yoksa `from` + 14 gündür; `to` yalnız `from` ile verilir,
 * aralık en çok 28 gündür. API sorgu şemasıdır (bilinmeyen parametre 400).
 */
export const bookableSlotsQuerySchema = z
  .strictObject({
    studentId: identifier('Bir öğrenci seçin.'),
    from: instant.optional(),
    to: instant.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.to === undefined) return
    if (data.from === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Bitiş verildiğinde başlangıcı da verin.',
      })
      return
    }
    const span = Date.parse(data.to) - Date.parse(data.from)
    if (span <= 0)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan sonra olmalıdır.' })
    else if (span > BOOKABLE_SLOTS_MAX_DAYS * DAY_MS)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Aralık en fazla ${BOOKABLE_SLOTS_MAX_DAYS} gün olabilir.`,
      })
  })
export type BookableSlotsQuery = z.input<typeof bookableSlotsQuerySchema>

/**
 * Öğrenci ve velinin gördüğü uygunluk saati (DOM-ILT-105). Alanlar beyaz listedir: saatin iç
 * notu, saati tutan randevu ve onun sahibi hiç dönmez. `available: false` saatin dolu olduğunu
 * söyler, nedenini söylemez (DOM-ILT-073): başka velinin gizli görüşmesi de, öğrencinin kendi
 * dersi de aynı "Dolu"dur.
 */
export type BookableSlot = {
  slotId: string
  teacherId: string
  teacherName: string
  /** Başlangıç, ISO 8601 UTC. */
  startsAt: string
  /** Dakika. */
  duration: number
  /** Öğretmenin kampüsü; kampüs kaydı yoksa yok. */
  campusName?: string
  /** Öğretmenin öğrencinin sınıfında verdiği dersler (ada göre sıralı). */
  subjectNames: string[]
  available: boolean
}

const byStart = (a: BookableSlot, b: BookableSlot) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
  a.teacherName.localeCompare(b.teacherName, 'tr') ||
  a.slotId.localeCompare(b.slotId)

/**
 * Talep ekranının saatleri (DOM-ILT-105): öğrencinin sınıfına ders veren etkin öğretmenlerin
 * aralıktaki gelecek saatleri. Her saat talep (`bookAppointment`) ile aynı denetimden geçer
 * (`checkSlot`): bekleyen/onaylı randevunun tuttuğu ya da öğrencinin dersi, etüdü, randevusu
 * veya okul etkinliğiyle çakışan saat `available: false` olur. Saf okuma; State değişmez.
 *
 * Yetki `appointment.slots`: öğrenci kendisi, veli bağlı çocuğu için okur; kapsam dışı öğrenci
 * olmayan öğrenciyle aynı `student_not_found` (404). Pasif öğrenci talepteki gibi 422
 * `student_inactive`.
 */
export function bookableSlots(
  state: State,
  by: Participant,
  query: unknown,
  now: string,
  options: AppointmentOptions = {},
): BookableSlot[] {
  const data = bookableSlotsQuerySchema.parse(query)
  requireAuthorized(by, 'appointment.slots', { studentId: data.studentId }, state, options)
  const student = requireActiveStudent(state, data.studentId)
  const from = Date.parse(data.from ?? now)
  const to =
    data.to === undefined ? from + BOOKABLE_SLOTS_DEFAULT_DAYS * DAY_MS : Date.parse(data.to)
  const subjectName = new Map(state.subjects.map((s) => [s.id, s.name]))
  const campusName = new Map(state.branches.map((b) => [b.id, b.name]))
  // Öğretmen → öğrencinin sınıfında verdiği dersler; anahtar yoksa öğretmen sınıfa girmiyor.
  const subjectsOf = new Map<string, Set<string>>()
  for (const a of state.assignments)
    if (a.classId === student.classId) {
      const names = subjectsOf.get(a.teacherId) ?? new Set<string>()
      const name = subjectName.get(a.subjectId)
      if (name !== undefined) names.add(name)
      subjectsOf.set(a.teacherId, names)
    }
  const teacherById = new Map(state.teachers.map((t) => [t.id, t]))
  const scope = scopeFor(state, by, options)
  const slots: BookableSlot[] = []
  for (const slot of state.availability) {
    const starts = Date.parse(slot.date)
    if (!(starts >= from && starts < to) || !subjectsOf.has(slot.teacherId)) continue
    const check = checkSlot(state, scope, student, slot, now)
    // Ders vermeyen, pasif öğretmenin ve geçmiş saat listede hiç yoktur; yalnız çakışma "Dolu"dur.
    if (check.error && check.error.code !== 'appointment_conflict') continue
    const teacher = teacherById.get(slot.teacherId)
    if (!teacher) continue
    const campus = campusName.get(teacher.branchId)
    slots.push({
      slotId: slot.id,
      teacherId: teacher.id,
      teacherName: teacher.name,
      startsAt: new Date(starts).toISOString(),
      duration: slot.duration,
      ...(campus === undefined ? {} : { campusName: campus }),
      subjectNames: [...(subjectsOf.get(teacher.id) ?? [])].sort((a, b) =>
        a.localeCompare(b, 'tr'),
      ),
      available: check.error === undefined,
    })
  }
  return slots.sort(byStart)
}
