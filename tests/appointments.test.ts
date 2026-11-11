import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  APPOINTMENT_FINAL_STATUSES,
  APPOINTMENT_HOLDING_STATUSES,
  APPOINTMENT_STATUSES,
  appointmentClosed,
  appointmentHoldsTime,
  scheduledAppointments,
} from '../packages/school-core/src/lib/appointment-status.ts'
import {
  bookAppointment,
  requireVisibleAppointment,
  updateAppointment,
} from '../packages/school-core/src/lib/appointments.ts'
import { runAssessment } from '../packages/school-core/src/lib/assessment-automation.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import { tutorConflict } from '../packages/school-core/src/lib/tutor-conflicts.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) ve Nehir (s25) 7-A'da (c1); Ece (s2) 5-A'da (c2). Selin Kaya
// (t1) ve Ahmet Yıldırım (t2) 7-A'ya ders verir; Emre Demir (t5) yalnız lise sınıflarına.
// Örnek veride t1'in saatleri: slot-t1-0 7 Ekim 13:00Z (boş), slot-t1-2 9 Ekim 13:00Z (Ece'nin
// onaylı veli görüşmesi apt2 ile dolu). 7-A'nın dersleri 06:00Z–11:30Z arasındadır.
const now = '2026-10-06T10:00:00.000Z'
const later = '2026-10-07T12:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-appointments-test-${++sequence}`

const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
// Aynı çocuğun ikinci velisi (ayrı hesap, DOM-ILT-073).
const otherParent: Participant = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's1' }],
  userId: 'u-ikinci-veli',
}
const student: Participant = {
  role: 'ogrenci',
  links: [{ kind: 'student', recordId: 's1' }],
  userId: 'u-s1',
}
const teacher: Participant = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 't1' }],
  userId: 'u-t1',
}
const otherTeacher: Participant = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 't2' }],
  userId: 'u-t2',
}
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const booking = (overrides: Record<string, unknown> = {}) => ({
  studentId: 's1',
  slotId: 'slot-t1-0',
  note: 'Denklem problemlerini konuşmak istiyorum.',
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function addSlot(state: State, slotId: string, teacherId: string, date: string, duration = 30) {
  state.availability.push({ id: slotId, teacherId, date, duration })
}

function unchangedOnFailure(
  state: State,
  action: () => unknown,
  check: (error: unknown) => boolean,
) {
  const watched = () => JSON.stringify([state.appointments, state.availability])
  const before = watched()
  assert.throws(action, check)
  assert.equal(watched(), before)
}

function booked(state: State, by: Participant = parent, input = booking()) {
  return bookAppointment(state, by, input, id, now)
}

// --- Talep ---------------------------------------------------------------------------------

test('DOM-ILT-100, DOM-ILT-101: veli çocuğunun öğretmeninin uygunluk saatinden talep açar; saat ve süre slottan gelir', () => {
  const state = seed()
  const created = booked(state)
  assert.equal(state.appointments[0], created)
  assert.deepEqual(
    {
      studentId: created.studentId,
      teacherId: created.teacherId,
      date: created.date,
      duration: created.duration,
      slotId: created.slotId,
      type: created.type,
      status: created.status,
      requestedBy: created.requestedBy,
      createdAt: created.createdAt,
    },
    {
      studentId: 's1',
      teacherId: 't1',
      date: '2026-10-07T13:00:00.000Z',
      duration: 30,
      slotId: 'slot-t1-0',
      type: 'Veli görüşmesi',
      status: 'Bekliyor',
      requestedBy: { role: 'veli', userId: 'u-ayse' },
      createdAt: now,
    },
  )
  assert.deepEqual(created.history, [
    { status: 'Bekliyor', at: now, by: { role: 'veli', userId: 'u-ayse' } },
  ])
  // Uygunluk saati silinmez; aynı saat artık doludur.
  assert.ok(state.availability.some((slot) => slot.id === 'slot-t1-0'))
})

test('DOM-ILT-100: öğrenci kendisi için talep açar; tür rolüne göre sınırlıdır', () => {
  const state = seed()
  const own = booked(state, student, booking({ slotId: 'slot-t2-0' }))
  assert.equal(own.type, 'Bireysel etüt')
  assert.deepEqual(own.requestedBy, { role: 'ogrenci', userId: 'u-s1' })
  const counselling = booked(
    state,
    parent,
    booking({ slotId: 'slot-t1-3', type: 'Akademik danışmanlık' }),
  )
  assert.equal(counselling.type, 'Akademik danışmanlık')
  unchangedOnFailure(
    state,
    () => booked(state, student, booking({ slotId: 'slot-t1-1', type: 'Veli görüşmesi' })),
    (error) => isDomainError('appointment_type_invalid')(error),
  )
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-t1-1', type: 'Bireysel etüt' })),
    (error) =>
      isDomainError('appointment_type_invalid')(error) &&
      JSON.stringify((error as { path?: unknown }).path) === '["type"]',
  )
})

test('DOM-YTK-025, DOM-YTK-001: başka velinin çocuğu 403; yönetici, ön büro ve öğretmen talep açamaz', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ studentId: 's25' })),
    isDomainError('student_scope_denied', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => booked(state, student, booking({ studentId: 's25' })),
    isDomainError('student_scope_denied', 'forbidden'),
  )
  for (const actor of [admin, front, teacher])
    unchangedOnFailure(
      state,
      () => booked(state, actor),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-YTK-025: pasif öğrenci için talep açılamaz', () => {
  const state = seed()
  const deniz = state.students.find((s) => s.id === 's1')
  assert.ok(deniz)
  deniz.isActive = false
  unchangedOnFailure(
    state,
    () => booked(state),
    (error) =>
      isDomainError('student_inactive')(error) &&
      JSON.stringify((error as { path?: unknown }).path) === '["studentId"]',
  )
})

test('DOM-ILT-101: olmayan, başka öğretmenin, ders vermeyen veya pasif öğretmenin saati aynı 422', () => {
  const state = seed()
  addSlot(state, 'slot-test-t5', 't5', '2026-10-08T13:00:00.000Z')
  const slotPath = (error: unknown) =>
    isDomainError('appointment_slot_unavailable')(error) &&
    JSON.stringify((error as { path?: unknown }).path) === '["slotId"]'
  for (const slotId of ['slot-yok', 'slot-test-t5'])
    unchangedOnFailure(state, () => booked(state, parent, booking({ slotId })), slotPath)
  const t1 = state.teachers.find((t) => t.id === 't1')
  assert.ok(t1)
  t1.isActive = false
  unchangedOnFailure(state, () => booked(state), slotPath)
})

test('DOM-ILT-101: geçmiş uygunluk saati 422 appointment_in_past', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => bookAppointment(state, parent, booking(), id, '2026-10-07T13:00:00.000Z'),
    isDomainError('appointment_in_past'),
  )
})

test('DOM-ILT-101: ders, randevu, etüt ve okul etkinliğiyle çakışan saat 409', () => {
  const state = seed()
  const conflict = (pattern: RegExp) => (error: unknown) =>
    isDomainError('appointment_conflict', 'conflict')(error) &&
    pattern.test((error as Error).message) &&
    JSON.stringify((error as { path?: unknown }).path) === '["slotId"]'
  // Ece'nin onaylı veli görüşmesi (apt2) t1'in 9 Ekim 13:00 saatini tutar. Açanı bilinmeyen eski
  // kayıt veliye kapalıdır; ileti genel kalır (DOM-ILT-103).
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-t1-2' })),
    conflict(/^Bu saat uygun değil\.$/),
  )
  // t1'in 7 Ekim 06:50'de 8. sınıfta dersi var.
  addSlot(state, 'slot-test-lesson', 't1', '2026-10-07T06:50:00.000Z')
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-test-lesson' })),
    conflict(/dersi var/),
  )
  // 14 Ekim'de kampüsün bütününe açık okul etkinliği (09:00–14:00Z).
  addSlot(state, 'slot-test-event', 't1', '2026-10-14T12:30:00.000Z')
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-test-event' })),
    conflict(/okul etkinliği/),
  )
  // Öğrencinin aynı saatte başka öğretmenle randevusu varsa da çakışır; veli kendi açtığı
  // görüşmeyi görür.
  booked(state, parent, booking({ slotId: 'slot-t2-0' }))
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-t1-0' })),
    conflict(/Öğrencinin bu saatte randevusu var/),
  )
  // Öğretmenin etüdü de saati tutar.
  state.tutorSessions.push({
    id: 'tutor-test',
    teacherId: 't1',
    date: '2026-10-08T14:00:00.000Z',
    duration: 30,
    branchId: 'b1',
    room: 'Etüt 1',
    studentIds: ['s25'],
    status: 'Planlandı',
  } as State['tutorSessions'][number])
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-t1-1' })),
    conflict(/başka etüdü var/),
  )
})

test('DOM-ILT-073, DOM-ILT-103: göremediği randevuyla çakışmada ileti genel kalır; gördüğünde ayrıntılı', () => {
  const state = seed()
  const hidden = (error: unknown) =>
    isDomainError('appointment_conflict', 'conflict')(error) &&
    (error as Error).message === 'Bu saat uygun değil.' &&
    JSON.stringify((error as { path?: unknown }).path) === '["slotId"]'
  const detailed = (error: unknown) =>
    isDomainError('appointment_conflict', 'conflict')(error) &&
    (error as Error).message === 'Öğrencinin bu saatte randevusu var.'
  // Veli A, t1 ile 7 Ekim 13:00'te görüşme açar; aynı saat t2'de de vardır (slot-t2-0).
  booked(state, parent)
  // Aynı çocuğun ikinci velisi ve öğrenci bu görüşmeyi görmez: genel ileti.
  unchangedOnFailure(
    state,
    () => booked(state, otherParent, booking({ slotId: 'slot-t2-0' })),
    hidden,
  )
  unchangedOnFailure(state, () => booked(state, student, booking({ slotId: 'slot-t2-0' })), hidden)
  // Açan veli kendi görüşmesini görür: ayrıntılı ileti.
  unchangedOnFailure(state, () => booked(state, parent, booking({ slotId: 'slot-t2-0' })), detailed)
  // Öğrencinin kendi randevusu iki veliye de görünür: ayrıntılı ileti.
  const other = seed()
  booked(other, student)
  unchangedOnFailure(
    other,
    () => booked(other, otherParent, booking({ slotId: 'slot-t2-0' })),
    detailed,
  )
  // Onayda da aynı kural: t2 görmediği t1 randevusuyla çakışan talebi onaylarken genel ileti alır.
  const approval = seed()
  const pending = booked(approval, student, booking({ slotId: 'slot-t2-0' }))
  const held = approval.appointments.find((a) => a.id === pending.id)!
  approval.appointments.push({
    ...held,
    id: 'apt-test-t1',
    teacherId: 't1',
    slotId: 'slot-t1-0',
    status: 'Onaylandı',
  })
  assert.throws(
    () => updateAppointment(approval, otherTeacher, pending.id, { status: 'Onaylandı' }, now),
    (error: unknown) =>
      isDomainError('appointment_conflict', 'conflict')(error) &&
      (error as Error).message === 'Bu saat uygun değil.',
  )
  // Kapsam seçeneği verilmeyen denetim (etüt, sınıf düzenleme) ayrıntılı iletiyi korur.
  assert.equal(
    tutorConflict(approval, {
      teacherId: 't5',
      date: held.date,
      branchId: 'b1',
      room: '',
      studentIds: ['s1'],
    }),
    'Öğrencinin bu saatte randevusu var.',
  )
})

test('DOM-ILT-101: aynı saate ikinci talep çakışma alır; ilk talep tek kalır', () => {
  const state = seed()
  booked(state)
  const before = state.appointments.length
  assert.throws(() => booked(state, otherParent), isDomainError('appointment_conflict', 'conflict'))
  assert.equal(state.appointments.length, before)
})

test('DOM-ILT-100: eksik not, bilinmeyen alan ve geçersiz tür doğrulama hatasıdır; kayıt değişmez', () => {
  const state = seed()
  for (const input of [
    booking({ note: ' ' }),
    booking({ slotId: '' }),
    booking({ type: 'Kahve sohbeti' }),
    { ...booking(), teacherId: 't2' },
    { ...booking(), date: '2026-10-07T08:00:00.000Z' },
  ])
    unchangedOnFailure(state, () => booked(state, parent, input), zodError)
})

test('DOM-YTK-040: iletişim modülü kapalıyken talep ve durum değişikliği reddedilir', () => {
  const state = seed()
  const created = booked(state)
  state.modules.communication = false
  unchangedOnFailure(
    state,
    () => booked(state, parent, booking({ slotId: 'slot-t1-1' })),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Onaylandı' }, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

// --- Durum ---------------------------------------------------------------------------------

test('DOM-ILT-102: öğretmen bekleyen talebi onaylar; geçmişe eklenir, onaylı randevu yeniden değerlendirilmez', () => {
  const state = seed()
  const created = booked(state)
  const approved = updateAppointment(state, teacher, created.id, { status: 'Onaylandı' }, later)
  assert.equal(approved.status, 'Onaylandı')
  assert.equal(approved.updatedAt, later)
  assert.deepEqual(approved.history?.at(-1), {
    status: 'Onaylandı',
    at: later,
    by: { role: 'ogretmen', userId: 'u-t1' },
  })
  for (const status of ['Onaylandı', 'Reddedildi'])
    unchangedOnFailure(
      state,
      () =>
        updateAppointment(state, teacher, created.id, { status, reason: 'Uygun değilim.' }, later),
      (error) =>
        isDomainError('appointment_transition_invalid')(error) &&
        JSON.stringify((error as { path?: unknown }).path) === '["status"]',
    )
  unchangedOnFailure(
    state,
    () => updateAppointment(state, parent, created.id, { status: 'Geri çekildi' }, later),
    isDomainError('appointment_transition_invalid'),
  )
})

test('DOM-ILT-102: red gerekçe ister; reddedilen randevu son durumdur ve saati bırakır (DOM-ILT-104)', () => {
  const state = seed()
  const created = booked(state)
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Reddedildi' }, now),
    zodError,
  )
  const rejected = updateAppointment(
    state,
    teacher,
    created.id,
    { status: 'Reddedildi', reason: 'Bu saatte toplantım var.' },
    now,
  )
  assert.equal(rejected.status, 'Reddedildi')
  assert.equal(rejected.history?.at(-1)?.reason, 'Bu saatte toplantım var.')
  for (const status of ['Onaylandı', 'Geri çekildi'])
    unchangedOnFailure(
      state,
      () => updateAppointment(state, teacher, created.id, { status }, now),
      isDomainError('appointment_closed', 'conflict'),
    )
  // Saat yeniden talep edilebilir; reddedilen kayıt silinmez.
  const again = booked(state, otherParent)
  assert.equal(again.date, created.date)
  assert.ok(state.appointments.some((a) => a.id === created.id && a.status === 'Reddedildi'))
})

test('DOM-ILT-102: onayı ve reddi yalnız ilgili öğretmen verir; başka öğretmen kaydı görmez (404)', () => {
  const state = seed()
  const created = booked(state)
  unchangedOnFailure(
    state,
    () => updateAppointment(state, parent, created.id, { status: 'Onaylandı' }, now),
    isDomainError('appointment_teacher_only', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => updateAppointment(state, otherTeacher, created.id, { status: 'Onaylandı' }, now),
    isDomainError('appointment_not_found', 'not_found'),
  )
  for (const actor of [admin, front])
    unchangedOnFailure(
      state,
      () => updateAppointment(state, actor, created.id, { status: 'Onaylandı' }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, 'apt-yok', { status: 'Onaylandı' }, now),
    isDomainError('appointment_not_found', 'not_found'),
  )
})

test('DOM-ILT-102: onay anında saat gelecekte olmalı, öğrenci etkin olmalı ve çakışma yeniden denetlenir', () => {
  const state = seed()
  const created = booked(state)
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Onaylandı' }, created.date),
    isDomainError('appointment_in_past'),
  )
  // Talepten sonra aynı saate etüt planlandı.
  state.tutorSessions.push({
    id: 'tutor-test-late',
    teacherId: 't1',
    date: created.date,
    duration: 30,
    branchId: 'b1',
    room: 'Etüt 2',
    studentIds: ['s25'],
    status: 'Planlandı',
  } as State['tutorSessions'][number])
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Onaylandı' }, now),
    isDomainError('appointment_conflict', 'conflict'),
  )
  state.tutorSessions.pop()
  const deniz = state.students.find((s) => s.id === 's1')
  assert.ok(deniz)
  deniz.isActive = false
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Onaylandı' }, now),
    isDomainError('student_inactive'),
  )
  // Pasif öğrencinin bekleyen talebi reddedilebilir.
  const rejected = updateAppointment(
    state,
    teacher,
    created.id,
    { status: 'Reddedildi', reason: 'Öğrencinin kaydı kapandı.' },
    now,
  )
  assert.equal(rejected.status, 'Reddedildi')
})

test('DOM-ILT-102: talep eden onaydan önce geri çeker; başkası geri çekemez', () => {
  const state = seed()
  const created = booked(state, student)
  // Veli çocuğunun öğrenci talebini görür ama açan o değildir.
  unchangedOnFailure(
    state,
    () => updateAppointment(state, parent, created.id, { status: 'Geri çekildi' }, now),
    isDomainError('appointment_requester_only', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => updateAppointment(state, teacher, created.id, { status: 'Geri çekildi' }, now),
    isDomainError('appointment_requester_only', 'forbidden'),
  )
  const withdrawn = updateAppointment(state, student, created.id, { status: 'Geri çekildi' }, now)
  assert.equal(withdrawn.status, 'Geri çekildi')
  assert.equal(appointmentClosed(withdrawn), true)
  assert.equal(appointmentHoldsTime(withdrawn), false)
})

test('DOM-ILT-102: onaylı randevuyu öğretmen veya talep eden gerekçeyle başlamadan iptal eder', () => {
  const state = seed()
  const first = booked(state)
  unchangedOnFailure(
    state,
    () =>
      updateAppointment(state, parent, first.id, { status: 'İptal', reason: 'Gelemiyorum.' }, now),
    (error) =>
      isDomainError('appointment_transition_invalid')(error) &&
      JSON.stringify((error as { path?: unknown }).path) === '["status"]',
  )
  updateAppointment(state, teacher, first.id, { status: 'Onaylandı' }, now)
  unchangedOnFailure(
    state,
    () => updateAppointment(state, parent, first.id, { status: 'İptal' }, now),
    zodError,
  )
  unchangedOnFailure(
    state,
    () =>
      updateAppointment(state, student, first.id, { status: 'İptal', reason: 'Hastayım.' }, now),
    isDomainError('appointment_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    () =>
      updateAppointment(
        state,
        parent,
        first.id,
        { status: 'İptal', reason: 'Gelemiyorum.' },
        first.date,
      ),
    isDomainError('appointment_in_past'),
  )
  const cancelled = updateAppointment(
    state,
    parent,
    first.id,
    { status: 'İptal', reason: 'İş seyahatim çıktı.' },
    now,
  )
  assert.equal(cancelled.status, 'İptal')
  assert.deepEqual(
    cancelled.history?.map((event) => event.status),
    ['Bekliyor', 'Onaylandı', 'İptal'],
  )
  // Öğretmen de kendi onayladığı randevuyu iptal eder.
  const second = booked(state, student, booking({ slotId: 'slot-t1-1' }))
  updateAppointment(state, teacher, second.id, { status: 'Onaylandı' }, now)
  const byTeacher = updateAppointment(
    state,
    teacher,
    second.id,
    { status: 'İptal', reason: 'Sınav görevim var.' },
    now,
  )
  assert.equal(byTeacher.status, 'İptal')
  // Başka velinin onaylı görüşmesini veli görmez: iptal girişimi 404.
  const third = booked(state, otherParent, booking({ slotId: 'slot-t1-3' }))
  updateAppointment(state, teacher, third.id, { status: 'Onaylandı' }, now)
  unchangedOnFailure(
    state,
    () => updateAppointment(state, parent, third.id, { status: 'İptal', reason: 'Deneme.' }, now),
    isDomainError('appointment_not_found', 'not_found'),
  )
})

test('DOM-ILT-102: açanı bilinmeyen eski talep geri çekilemez (TODO randevu-eski-kayit)', () => {
  const state = seed()
  // apt1: Deniz'in açanı kayıtlı olmayan bekleyen etüt talebi.
  unchangedOnFailure(
    state,
    () => updateAppointment(state, student, 'apt1', { status: 'Geri çekildi' }, now),
    isDomainError('appointment_requester_only', 'forbidden'),
  )
  const approved = updateAppointment(state, teacher, 'apt1', { status: 'Onaylandı' }, now)
  assert.deepEqual(
    approved.history?.map((event) => event.status),
    ['Onaylandı'],
  )
})

// --- Görünürlük ve takvim ------------------------------------------------------------------

test('DOM-ILT-103, DOM-ILT-073: veli görüşmesini yalnız açan veli görür; öğrenci ve başka veli görmez', () => {
  const state = seed()
  const meeting = booked(state)
  const own = booked(state, student, booking({ slotId: 'slot-t2-1' }))
  const ids = (actor: Participant) => visibleRecords(state, actor, 'appointments').map((a) => a.id)
  assert.ok(ids(parent).includes(meeting.id))
  assert.ok(ids(parent).includes(own.id))
  assert.equal(ids(otherParent).includes(meeting.id), false)
  assert.ok(ids(otherParent).includes(own.id))
  assert.equal(ids(student).includes(meeting.id), false)
  assert.ok(ids(student).includes(own.id))
  assert.ok(ids(teacher).includes(meeting.id))
  assert.equal(ids(teacher).includes(own.id), false)
  assert.ok(ids(otherTeacher).includes(own.id))
  assert.ok(ids(admin).includes(meeting.id))
  assert.deepEqual(ids(front), [])
  // Açanı bilinmeyen eski veli görüşmesi (apt2, Ece) veliye ve öğrenciye kapalıdır.
  assert.equal(ids(parent).includes('apt2'), false)
  assert.ok(ids(parent).includes('apt1'))
  // Görmediği kayıt üzerinde işlem olmayan kayıtla aynıdır.
  assert.throws(
    () => requireVisibleAppointment(state, otherParent, meeting.id),
    isDomainError('appointment_not_found', 'not_found'),
  )
  assert.throws(
    () => requireVisibleAppointment(state, otherParent, 'apt-yok'),
    isDomainError('appointment_not_found', 'not_found'),
  )
  assert.equal(requireVisibleAppointment(state, parent, meeting.id), meeting)
})

test('DOM-ILT-104: yalnız bekleyen ve onaylı randevu zamanı tutar; programda yalnız onaylı görünür', () => {
  assert.deepEqual(APPOINTMENT_STATUSES, [
    ...APPOINTMENT_HOLDING_STATUSES,
    ...APPOINTMENT_FINAL_STATUSES,
  ])
  for (const status of APPOINTMENT_HOLDING_STATUSES)
    assert.equal(appointmentHoldsTime({ status }), true)
  for (const status of APPOINTMENT_FINAL_STATUSES) {
    assert.equal(appointmentHoldsTime({ status }), false)
    assert.equal(appointmentClosed({ status }), true)
  }
  // Durumu bilinmeyen kayıt takvimi boşaltmaz.
  assert.equal(appointmentHoldsTime({}), true)
  assert.equal(appointmentClosed({}), false)
  const list = APPOINTMENT_STATUSES.map((status, index) => ({ id: `a${index}`, status }))
  assert.deepEqual(
    scheduledAppointments(list).map((a) => a.id),
    ['a1'],
  )
  // Çakışma denetimi kapanan randevuyu yok sayar.
  const state = seed()
  const created = booked(state)
  const candidate = {
    teacherId: 't1',
    date: created.date,
    branchId: 'b1',
    room: '',
    studentIds: [],
  }
  assert.match(tutorConflict(state, candidate), /randevusu var/)
  updateAppointment(state, parent, created.id, { status: 'Geri çekildi' }, now)
  assert.equal(tutorConflict(state, candidate), '')
})

test('DOM-ILT-101: bekleyen veya onaylı randevusu olan uygunluk saati kaldırılamaz; kapanınca kaldırılır', () => {
  const state = seed()
  const teacherSession = { role: 'ogretmen' as const, links: teacher.links }
  const remove = (slotId: string) =>
    runAssessment(state, teacherSession, 'slot-remove', {}, id, slotId, now)
  const blocked = (error: unknown) =>
    isDomainError('availability_has_appointments', 'conflict')(error) &&
    JSON.stringify((error as { path?: unknown }).path) === '["slotId"]'
  // Bekleyen talep.
  const pending = booked(state)
  unchangedOnFailure(state, () => remove('slot-t1-0'), blocked)
  // Onaylı randevu.
  updateAppointment(state, teacher, pending.id, { status: 'Onaylandı' }, now)
  unchangedOnFailure(state, () => remove('slot-t1-0'), blocked)
  // Saati bilinmeyen eski onaylı randevu (apt2) aynı aralıktaki saati de tutar.
  unchangedOnFailure(state, () => remove('slot-t1-2'), blocked)
  // Kapanan randevu saati bırakır (DOM-ILT-104).
  updateAppointment(state, teacher, pending.id, { status: 'İptal', reason: 'Toplantı çıktı.' }, now)
  remove('slot-t1-0')
  assert.equal(
    state.availability.some((slot) => slot.id === 'slot-t1-0'),
    false,
  )
})
