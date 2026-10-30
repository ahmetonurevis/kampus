import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  BOOKABLE_SLOTS_MAX_DAYS,
  bookableSlots,
  bookableSlotsQuerySchema,
  bookAppointment,
  type BookableSlot,
} from '../packages/school-core/src/lib/appointments.ts'
import { isDomainError } from './support/domain-error.ts'

// Alınabilir randevu saatleri (docs/domain/iletisim-ve-veli.md DOM-ILT-105). 2026-10-06 salıdır.
// Deniz (s1) ve Nehir (s25) 7-A'da (c1), Ece (s2) 5-A'da (c2); iki sınıfa da on öğretmen girer
// (t1 Selin Kaya, t2 Ahmet Yıldırım …), Emre Demir (t5) yalnız lise sınıflarına. Her öğretmenin
// 7–10 Ekim 13:00/14:00Z saatleri vardır. Ece'nin onaylı veli görüşmesi (apt2) t1'in 9 Ekim
// 13:00 saatini (`slot-t1-2`) tutar.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-appointment-slots-test-${++sequence}`

const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
const otherParent: Participant = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's25' }],
  userId: 'u-nehir-veli',
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
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const NOTE = 'Denklem problemlerini konuşmak istiyorum.'
const C1_TEACHERS = (state: State) =>
  new Set(state.assignments.filter((a) => a.classId === 'c1').map((a) => a.teacherId))
const slotOf = (slots: readonly BookableSlot[], slotId: string) => {
  const slot = slots.find((s) => s.slotId === slotId)
  assert.ok(slot, `${slotId} listede yok`)
  return slot
}
const availableOf = (slots: readonly BookableSlot[], slotId: string) =>
  slotOf(slots, slotId).available
/** Okuma State'i değiştirmez. */
function readOnly<T>(state: State, read: () => T): T {
  const before = JSON.stringify(state)
  const result = read()
  assert.equal(JSON.stringify(state), before)
  return result
}

test('DOM-ILT-105: öğrenci kendi sınıfına ders veren etkin öğretmenlerin gelecek saatlerini sıralı görür', () => {
  const state = seed()
  const slots = readOnly(state, () => bookableSlots(state, student, { studentId: 's1' }, now))
  const teachers = C1_TEACHERS(state)
  const expected = state.availability.filter((s) => teachers.has(s.teacherId))
  assert.equal(slots.length, expected.length)
  assert.ok(slots.every((s) => teachers.has(s.teacherId)))
  assert.ok(!slots.some((s) => s.teacherId === 't5'))
  assert.ok(slots.every((s) => Date.parse(s.startsAt) > Date.parse(now)))
  const starts = slots.map((s) => Date.parse(s.startsAt))
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
  )
  assert.deepEqual(slotOf(slots, 'slot-t1-0'), {
    slotId: 'slot-t1-0',
    teacherId: 't1',
    teacherName: 'Selin Kaya',
    startsAt: '2026-10-07T13:00:00.000Z',
    duration: 30,
    campusName: 'Kadıköy Kampüsü',
    subjectNames: ['Matematik'],
    available: true,
  })
})

test('DOM-ILT-105: yalnız gelecekteki saatler; varsayılan aralık 14 gün, en çok 28 gün okunur', () => {
  const state = seed()
  state.availability.push(
    { id: 'slot-test-now', teacherId: 't1', date: '2026-10-07T13:30:00.000Z', duration: 30 },
    { id: 'slot-test-day20', teacherId: 't1', date: '2026-10-26T13:00:00.000Z', duration: 30 },
  )
  const later = '2026-10-07T13:30:00.000Z'
  const ids = (slots: BookableSlot[]) => slots.map((s) => s.slotId)
  const atLater = bookableSlots(state, student, { studentId: 's1' }, later)
  // 7 Ekim 13:00 geçmiş, 13:30 tam şimdi: ikisi de listede yok.
  assert.ok(!ids(atLater).includes('slot-t1-0'))
  assert.ok(!ids(atLater).includes('slot-test-now'))
  assert.ok(ids(atLater).includes('slot-t1-1'))
  // Geçmişten başlayan aralık da geçmiş saati göstermez.
  const pastRange = bookableSlots(
    state,
    student,
    { studentId: 's1', from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' },
    later,
  )
  assert.ok(!ids(pastRange).includes('slot-t1-0'))
  // 20 gün sonraki saat varsayılan 14 günde yok, 28 günlük aralıkta var.
  assert.ok(
    !ids(bookableSlots(state, student, { studentId: 's1' }, now)).includes('slot-test-day20'),
  )
  const wide = bookableSlots(
    state,
    student,
    { studentId: 's1', from: now, to: '2026-11-03T10:00:00.000Z' },
    now,
  )
  assert.ok(ids(wide).includes('slot-test-day20'))
  // Yalnız başlangıç verilirse 14 gün o andan sayılır.
  const fromOnly = bookableSlots(
    state,
    student,
    { studentId: 's1', from: '2026-10-20T00:00:00.000Z' },
    now,
  )
  assert.deepEqual(ids(fromOnly), ['slot-test-day20'])
})

test('DOM-ILT-105: geçersiz aralık ve bilinmeyen parametre doğrulama hatasıdır', () => {
  const state = seed()
  const zod = (error: unknown) => error instanceof Error && error.name === 'ZodError'
  const tooLong = new Date(Date.parse(now) + (BOOKABLE_SLOTS_MAX_DAYS * 24 + 1) * 3_600_000)
  for (const query of [
    { studentId: 's1', to: '2026-10-10T00:00:00.000Z' },
    { studentId: 's1', from: '2026-10-10T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z' },
    { studentId: 's1', from: now, to: tooLong.toISOString() },
    { studentId: 's1', from: 'yarın' },
    { studentId: 's1', institutionId: 'baska' },
    { studentId: '' },
    {},
  ])
    assert.throws(() => readOnly(state, () => bookableSlots(state, parent, query, now)), zod)
  // Tam 28 gün geçerlidir.
  const exact = new Date(Date.parse(now) + BOOKABLE_SLOTS_MAX_DAYS * 86_400_000).toISOString()
  assert.equal(
    bookableSlotsQuerySchema.safeParse({ studentId: 's1', from: now, to: exact }).success,
    true,
  )
})

test('DOM-ILT-105, DOM-ILT-073: başka öğrencinin randevusunun tuttuğu saat dolu; neden ve tutan kişi dönmez', () => {
  const state = seed()
  const slots = bookableSlots(state, parent, { studentId: 's1' }, now)
  assert.equal(availableOf(slots, 'slot-t1-2'), false)
  assert.equal(availableOf(slots, 'slot-t2-2'), true)
  const keys = new Set(slots.flatMap((s) => Object.keys(s)))
  assert.deepEqual([...keys].sort(), [
    'available',
    'campusName',
    'duration',
    'slotId',
    'startsAt',
    'subjectNames',
    'teacherId',
    'teacherName',
  ])
  const text = JSON.stringify(slots)
  for (const leak of ['apt2', 's2', 'Veli görüşmesi', 'uygun değil', 'randevusu var', 'reason'])
    assert.equal(text.includes(leak), false, leak)
})

test('DOM-ILT-105, DOM-ILT-101: öğrencinin dersi, randevusu, etüdü ve okul etkinliğiyle çakışan saat dolu; talep aynı kararı verir', () => {
  const state = seed()
  // Öğrencinin kendi talebi (t2, 7 Ekim 13:00) aynı saatteki bütün öğretmen saatlerini doldurur.
  bookAppointment(state, student, { studentId: 's1', slotId: 'slot-t2-0', note: NOTE }, id, now)
  // 7-A'nın 8 Ekim 14:00'te dersi: sınıfın bütün öğrencileri için o saatteki bütün saatler dolar.
  state.schedule.push({
    id: 'lesson-test-c1',
    classId: 'c1',
    teacherId: 't16',
    subjectId: 'religion',
    date: '2026-10-08T14:00:00.000Z',
    duration: 40,
    title: 'Din Kültürü',
    room: '7-A',
  } as State['schedule'][number])
  // Öğrencinin 9 Ekim 13:00'te etüdü.
  state.tutorSessions.push({
    id: 'tutor-test-s1',
    teacherId: 't3',
    date: '2026-10-09T13:00:00.000Z',
    duration: 30,
    branchId: 'b1',
    room: 'Etüt 1',
    studentIds: ['s1'],
    status: 'Planlandı',
  } as State['tutorSessions'][number])
  // 7-A'ya 10 Ekim 13:30–15:00Z okul etkinliği.
  state.schoolEvents.push({
    ...state.schoolEvents[0],
    id: 'event-test-c1',
    classId: 'c1',
    branchId: 'b1',
    date: '2026-10-10T13:30:00.000Z',
    endDate: '2026-10-10T15:00:00.000Z',
    status: 'Planlandı',
  } as State['schoolEvents'][number])
  const mine = readOnly(state, () => bookableSlots(state, student, { studentId: 's1' }, now))
  for (const slotId of ['slot-t1-0', 'slot-t4-0', 'slot-t1-1', 'slot-t2-2', 'slot-t1-3'])
    assert.equal(availableOf(mine, slotId), false, slotId)
  // Aynı sınıftaki Nehir yalnız sınıfın ortak dersi ve etkinliğinden etkilenir.
  const theirs = bookableSlots(state, otherParent, { studentId: 's25' }, now)
  assert.equal(availableOf(theirs, 'slot-t1-0'), true)
  assert.equal(availableOf(theirs, 'slot-t2-0'), false)
  assert.equal(availableOf(theirs, 'slot-t4-2'), true)
  assert.equal(availableOf(theirs, 'slot-t1-1'), false)
  assert.equal(availableOf(theirs, 'slot-t1-3'), false)
  // Liste talebin kararıyla aynıdır: dolu saat çakışma alır, boş saat talep edilir.
  for (const slot of mine) {
    const copy = structuredClone(state)
    const attempt = () =>
      bookAppointment(copy, student, { studentId: 's1', slotId: slot.slotId, note: NOTE }, id, now)
    if (slot.available) assert.doesNotThrow(attempt, slot.slotId)
    else assert.throws(attempt, isDomainError('appointment_conflict', 'conflict'), slot.slotId)
  }
})

test('DOM-ILT-105, DOM-ILT-104: kapanan randevu saati bırakır', () => {
  const state = seed()
  const apt2 = state.appointments.find((a) => a.id === 'apt2')
  assert.ok(apt2)
  apt2.status = 'İptal'
  assert.equal(
    availableOf(bookableSlots(state, parent, { studentId: 's1' }, now), 'slot-t1-2'),
    true,
  )
})

test('DOM-ILT-105: veli her çocuğu için ayrı liste alır; başka velinin çocuğu ve olmayan öğrenci 404', () => {
  const state = seed()
  bookAppointment(state, parent, { studentId: 's1', slotId: 'slot-t2-1', note: NOTE }, id, now)
  const deniz = bookableSlots(state, parent, { studentId: 's1' }, now)
  const ece = bookableSlots(state, parent, { studentId: 's2' }, now)
  // Deniz'in talebi onun 8 Ekim 14:00 saatlerini, Ece'de yalnız t2'nin saatini doldurur.
  assert.equal(availableOf(deniz, 'slot-t1-1'), false)
  assert.equal(availableOf(ece, 'slot-t1-1'), true)
  assert.equal(availableOf(ece, 'slot-t2-1'), false)
  // Ece'nin kendi onaylı görüşmesi (apt2) onun 9 Ekim 13:00 saatlerini doldurur.
  assert.equal(availableOf(ece, 'slot-t2-2'), false)
  assert.equal(availableOf(deniz, 'slot-t2-2'), true)
  for (const query of [{ studentId: 's25' }, { studentId: 's-yok' }])
    assert.throws(
      () => readOnly(state, () => bookableSlots(state, parent, query, now)),
      isDomainError('student_not_found', 'not_found'),
    )
  assert.throws(
    () => bookableSlots(state, student, { studentId: 's25' }, now),
    isDomainError('student_not_found', 'not_found'),
  )
})

test('DOM-ILT-105, DOM-YTK-001: öğretmen, yönetici ve ön büro saat listesi okumaz', () => {
  const state = seed()
  for (const by of [teacher, admin, front])
    assert.throws(
      () => bookableSlots(state, by, { studentId: 's1' }, now),
      isDomainError('permission_denied', 'forbidden'),
      by.role,
    )
})

test('DOM-ILT-105, DOM-YTK-025: pasif öğrenci için talepteki gibi 422 student_inactive', () => {
  const state = seed()
  const deniz = state.students.find((s) => s.id === 's1')
  assert.ok(deniz)
  deniz.isActive = false
  assert.throws(
    () => readOnly(state, () => bookableSlots(state, parent, { studentId: 's1' }, now)),
    isDomainError('student_inactive'),
  )
})

test('DOM-ILT-105: pasif veya arşivli öğretmenin saati listede yoktur', () => {
  const state = seed()
  const ahmet = state.teachers.find((t) => t.id === 't2')
  const third = state.teachers.find((t) => t.id === 't3')
  assert.ok(ahmet && third)
  ahmet.isActive = false
  third.deletedAt = now
  const slots = bookableSlots(state, student, { studentId: 's1' }, now)
  assert.ok(!slots.some((s) => s.teacherId === 't2' || s.teacherId === 't3'))
  assert.ok(slots.some((s) => s.teacherId === 't1'))
})

test('DOM-YTK-040: iletişim modülü kapalıyken saat listesi okunmaz', () => {
  const state = seed()
  state.modules = { ...state.modules, communication: false }
  assert.throws(
    () => bookableSlots(state, parent, { studentId: 's1' }, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})
