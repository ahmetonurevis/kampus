import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  appointmentActions,
  appointmentLookups,
  appointmentRow,
  orderAppointments,
  pendingCount,
  upcomingSchedule,
} from '../src/pages/communication/appointment-rows.ts'

const NOW = '2026-10-15T09:00:00.000Z'
const FUTURE = '2026-10-20T10:00:00.000Z'
const PAST = '2026-10-10T10:00:00.000Z'

type Appointment = ReturnType<typeof createSeed>['appointments'][number]

const wrap = (record: Appointment, joined?: { studentName?: string }) => ({
  id: record.id,
  version: 4,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  record,
  ...(joined ? { joined } : {}),
})

const lookups = appointmentLookups([{ id: 't1', record: { name: 'Selin Kaya' } }])

const base: Appointment = {
  id: 'apt-x',
  studentId: 's1',
  teacherId: 't1',
  date: FUTURE,
  duration: 30,
  type: 'Bireysel etüt',
  note: 'Denklemleri konuşmak istiyorum.',
  status: 'Bekliyor',
  requestedBy: { role: 'ogrenci', userId: 'u-s1' },
  history: [{ status: 'Bekliyor', at: NOW, by: { role: 'ogrenci', userId: 'u-s1' } }],
}

test('DOM-ILT-102: öğretmen bekleyen talebi onaylar veya reddeder, geçmiş saatli talebi yalnız reddeder', () => {
  const row = { status: 'Bekliyor', startsAt: FUTURE, mine: false }
  assert.deepEqual(appointmentActions(row, 'teacher', NOW), ['approve', 'reject'])
  assert.deepEqual(appointmentActions({ ...row, startsAt: PAST }, 'teacher', NOW), ['reject'])
})

test('DOM-ILT-102: talep eden yalnız kendi bekleyen talebini geri çeker; başkasının talebine işlem yok', () => {
  const row = { status: 'Bekliyor', startsAt: FUTURE, mine: true }
  assert.deepEqual(appointmentActions(row, 'student', NOW), ['withdraw'])
  assert.deepEqual(appointmentActions(row, 'parent', NOW), ['withdraw'])
  assert.deepEqual(appointmentActions({ ...row, mine: false }, 'parent', NOW), [])
})

test('DOM-ILT-102: onaylı ve başlamamış randevuyu öğretmen ve talep eden iptal eder; geçmiş, sonuçlanmış ve başkasınınki iptal edilmez', () => {
  const row = { status: 'Onaylandı', startsAt: FUTURE, mine: false }
  assert.deepEqual(appointmentActions(row, 'teacher', NOW), ['cancel'])
  assert.deepEqual(appointmentActions({ ...row, mine: true }, 'student', NOW), ['cancel'])
  assert.deepEqual(appointmentActions(row, 'parent', NOW), [])
  assert.deepEqual(appointmentActions({ ...row, startsAt: PAST }, 'teacher', NOW), [])
  for (const status of ['Reddedildi', 'İptal', 'Geri çekildi'])
    assert.deepEqual(appointmentActions({ ...row, status, mine: true }, 'teacher', NOW), [])
})

test('DOM-ILT-102: açanı bilinmeyen eski talep geri çekilemez ve talep eden adına iptal edilemez', () => {
  const legacy: Appointment = { ...base }
  delete legacy.requestedBy
  const row = appointmentRow(wrap(legacy), lookups, 'student', 'u-s1', NOW)
  assert.equal(row.mine, false)
  assert.deepEqual(row.actions, [])
  const confirmed = appointmentRow(
    wrap({ ...legacy, status: 'Onaylandı' }),
    lookups,
    'student',
    'u-s1',
    NOW,
  )
  assert.deepEqual(confirmed.actions, [])
})

test('DOM-ILT-103: karşı taraf öğretmende öğrenci, öğrencide ve velide öğretmendir', () => {
  const item = wrap(base, { studentName: 'Deniz Yılmaz' })
  const teacher = appointmentRow(item, lookups, 'teacher', 'u-t1', NOW)
  assert.equal(teacher.counterpart, 'Deniz Yılmaz')
  assert.equal(teacher.mine, false)
  const student = appointmentRow(item, lookups, 'student', 'u-s1', NOW)
  assert.equal(student.counterpart, 'Selin Kaya')
  assert.equal(student.mine, true)
  assert.equal(student.version, 4)
  assert.equal(student.duration, 30)
  assert.match(student.when, /Eki 2026 13:00$/)
})

test('DOM-ILT-102: durum geçmişi rol ve gerekçeyle okunur, ad uydurulmaz', () => {
  const row = appointmentRow(
    wrap({
      ...base,
      status: 'Reddedildi',
      history: [
        ...(base.history ?? []),
        {
          status: 'Reddedildi',
          at: '2026-10-15T09:30:00.000Z',
          by: { role: 'ogretmen', userId: 'u-t1' },
          reason: 'O gün sınavım var.',
        },
      ],
    }),
    lookups,
    'student',
    'u-s1',
    NOW,
  )
  assert.deepEqual(
    row.history.map((entry) => [entry.label, entry.by, entry.reason]),
    [
      ['Talep açıldı', 'Öğrenci', ''],
      ['Reddedildi', 'Öğretmen', 'O gün sınavım var.'],
    ],
  )
  assert.equal(row.closed, true)
  assert.equal(row.open, false)
})

test('DOM-ILT-104: listede bekleyenler, onaylılar, sonra sonuçlananlar gelir', () => {
  const make = (id: string, status: string, date: string) =>
    appointmentRow(wrap({ ...base, id, status, date }), lookups, 'teacher', 'u-t1', NOW)
  const rows = orderAppointments([
    make('a-closed-old', 'İptal', '2026-10-01T10:00:00.000Z'),
    make('b-confirmed-late', 'Onaylandı', '2026-10-30T10:00:00.000Z'),
    make('c-pending', 'Bekliyor', '2026-10-25T10:00:00.000Z'),
    make('d-closed-new', 'Reddedildi', '2026-10-12T10:00:00.000Z'),
    make('e-confirmed-soon', 'Onaylandı', '2026-10-18T10:00:00.000Z'),
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    ['c-pending', 'e-confirmed-soon', 'b-confirmed-late', 'd-closed-new', 'a-closed-old'],
  )
  assert.equal(pendingCount(rows), 1)
})

test('DOM-ILT-104: programda yalnız onaylı ve başlamamış randevu görünür', () => {
  const make = (id: string, status: string, date: string) =>
    appointmentRow(wrap({ ...base, id, status, date }), lookups, 'teacher', 'u-t1', NOW)
  const schedule = upcomingSchedule(
    [
      make('pending', 'Bekliyor', FUTURE),
      make('cancelled', 'İptal', FUTURE),
      make('rejected', 'Reddedildi', FUTURE),
      make('withdrawn', 'Geri çekildi', FUTURE),
      make('past', 'Onaylandı', PAST),
      make('later', 'Onaylandı', '2026-10-28T10:00:00.000Z'),
      make('sooner', 'Onaylandı', '2026-10-16T10:00:00.000Z'),
    ],
    NOW,
  )
  assert.deepEqual(
    schedule.map((row) => row.id),
    ['sooner', 'later'],
  )
  assert.equal(upcomingSchedule([make('a', 'Onaylandı', FUTURE)], NOW, 0).length, 0)
})
