import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { authorize, requireAuthorized } from '../packages/school-core/src/lib/authorize.ts'
import {
  ATTENDANCE_CORRECTION_REASON_MIN,
  ATTENDANCE_STATUSES,
  attendanceCorrectionReasonSchema,
  attendanceInputSchema,
  recordAttendance,
  type AttendanceOptions,
} from '../packages/school-core/src/lib/domain.ts'
import { dayKey } from '../packages/school-core/src/lib/format.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Yoklama düzeltme geçmişi (DOM-AKD-035): var olan kaydın durumu değişince eski değer ezilmez,
 * `corrections` geçmişine eklenir. Yetki `authorize('attendance.record')` ile işlemden önce
 * denetlenir; API ile aynı sıra burada `take` yardımcısıyla kurulur.
 */

const now = '2026-10-06T10:00:00.000Z'
const yesterday = '2026-10-05T09:00:00.000Z'
const admin: Actor = { role: 'yonetici', links: [] }
const teacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
// t5 (edebiyat) 7-A'da ders vermez.
const otherTeacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't5' }] }
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function seed() {
  return createSeed(new Date(now))
}
function classMarks(state: State, status = 'present') {
  return Object.fromEntries(
    state.students.filter((s) => s.classId === 'c1' && s.isActive).map((s) => [s.id, status]),
  )
}
const entry = (state: State, studentId: string, date: string) =>
  state.attendance.find((a) => a.studentId === studentId && dayKey(a.date) === dayKey(date))

/** API sırası: önce yetki, sonra işlem; ikisi de aynı State üzerinde. */
function take(
  state: State,
  actor: Actor,
  date: string,
  marks: Record<string, string>,
  options: AttendanceOptions = {},
) {
  const reason = options.reason === undefined ? {} : { reason: options.reason }
  requireAuthorized(actor, 'attendance.record', { classId: 'c1', date, ...reason }, state, { now })
  recordAttendance(state, 'c1', date, marks, now, options)
}

test('Yönetici düzeltmesi eski durumu, gerekçeyi, düzelteni ve zamanı geçmişe yazar', () => {
  const state = seed()
  const marks = classMarks(state)
  const before = entry(state, 's1', yesterday)
  assert.ok(before, 'örnek veride s1 için dünün yoklaması olmalı')
  const previousStatus = before.status
  marks.s1 = previousStatus === 'absent' ? 'excused' : 'absent'
  for (const [id, status] of Object.entries(marks))
    if (id !== 's1') marks[id] = entry(state, id, yesterday)?.status ?? status
  const count = state.attendance.length
  take(state, admin, yesterday, marks, { reason: '  Veli raporu getirdi  ', by: 'user-admin' })
  assert.equal(state.attendance.length, count, 'kayıt yinelenmez')
  const after = entry(state, 's1', yesterday)
  assert.equal(after?.status, marks.s1)
  assert.deepEqual(after?.corrections, [
    {
      previousStatus,
      status: marks.s1,
      reason: 'Veli raporu getirdi',
      by: 'user-admin',
      at: now,
    },
  ])
})

test('Durumu değişmeyen öğrenciye geçmiş düşülmez; ilk yoklama geçmiş taşımaz', () => {
  const state = seed()
  const marks = classMarks(state)
  take(state, teacher, now, marks)
  const first = state.attendance.filter(
    (a) => a.classId === 'c1' && dayKey(a.date) === '2026-10-06',
  )
  assert.equal(first.length, Object.keys(marks).length)
  assert.ok(first.every((a) => a.corrections === undefined))
  // Aynı işaretlerle tekrar: hiçbir kayda geçmiş eklenmez.
  take(state, teacher, now, marks, { reason: 'Tekrar kaydedildi', by: 't1' })
  assert.ok(first.every((a) => a.corrections === undefined))
  // Yalnız değişen öğrenci geçmiş alır.
  take(state, teacher, now, { ...marks, s1: 'late' }, { by: 't1' })
  const changed = first.filter((a) => a.corrections !== undefined)
  assert.deepEqual(
    changed.map((a) => a.studentId),
    ['s1'],
  )
})

test('Öğretmenin aynı gün güncellemesi gerekçesiz de geçmişe yazılır; ikinci düzeltme eklenir', () => {
  const state = seed()
  const marks = classMarks(state)
  take(state, teacher, now, marks)
  take(state, teacher, now, { ...marks, s1: 'absent' }, { by: 't1' })
  take(state, teacher, now, { ...marks, s1: 'late' }, { reason: 'Ders başında geldi', by: 't1' })
  assert.deepEqual(entry(state, 's1', now)?.corrections, [
    { previousStatus: 'present', status: 'absent', reason: '', by: 't1', at: now },
    { previousStatus: 'absent', status: 'late', reason: 'Ders başında geldi', by: 't1', at: now },
  ])
  assert.equal(entry(state, 's1', now)?.status, 'late')
})

test('Gerekçesiz yönetici düzeltmesi reddedilir ve hiçbir kayıt değişmez', () => {
  const state = seed()
  const marks = classMarks(state, 'absent')
  const snapshot = JSON.stringify(state.attendance)
  for (const reason of [undefined, '', '   ', 'a'])
    assert.throws(
      () => take(state, admin, yesterday, marks, reason === undefined ? {} : { reason }),
      isDomainError('correction_reason_required'),
    )
  assert.equal(JSON.stringify(state.attendance), snapshot)
})

test('Doğrulama hatasında hiçbir kayıt ve geçmiş değişmez (atomik)', () => {
  const state = seed()
  const marks = classMarks(state)
  take(state, teacher, now, marks)
  const snapshot = JSON.stringify(state.attendance)
  // Değişen ilk öğrenciden sonra geçersiz işaret: ilk öğrenciye de geçmiş düşmemeli.
  const [first, second] = Object.keys(marks)
  assert.ok(first && second)
  assert.throws(
    () => take(state, teacher, now, { ...marks, [first]: 'absent', [second]: 'unknown' }),
    isDomainError('attendance_incomplete'),
  )
  // Çok uzun gerekçe: şema reddi, kayıt değişmez.
  assert.throws(
    () => take(state, teacher, now, { ...marks, [first]: 'absent' }, { reason: 'x'.repeat(501) }),
    zodError,
  )
  assert.throws(
    () => recordAttendance(state, 'c1', '2026-10-07T09:00:00.000Z', marks, now),
    isDomainError('attendance_future_date'),
  )
  assert.equal(JSON.stringify(state.attendance), snapshot)
})

test('Kapsam: başka sınıfın öğretmeni ve geçmiş günü düzelten öğretmen reddedilir', () => {
  const state = seed()
  const marks = classMarks(state, 'absent')
  const snapshot = JSON.stringify(state.attendance)
  assert.throws(
    () => take(state, otherTeacher, now, marks, { reason: 'Düzeltme' }),
    isDomainError('attendance_class_forbidden', 'forbidden'),
  )
  assert.throws(
    () => take(state, teacher, yesterday, marks, { reason: 'Düzeltme' }),
    isDomainError('attendance_correction_admin_only', 'forbidden'),
  )
  for (const role of ['onburo', 'ogrenci', 'veli'] as const)
    assert.throws(
      () => take(state, { role, links: [] }, now, marks, { reason: 'Düzeltme' }),
      isDomainError('permission_denied', 'forbidden'),
    )
  assert.equal(JSON.stringify(state.attendance), snapshot)
})

test('Yoklama girdi şeması durumları, günü ve gerekçe sınırını uygular', () => {
  assert.deepEqual([...ATTENDANCE_STATUSES], ['present', 'absent', 'late', 'excused'])
  const valid = { date: '2026-10-06', marks: { s1: 'present' } }
  assert.deepEqual(attendanceInputSchema.parse(valid), valid)
  assert.equal(
    attendanceInputSchema.parse({ ...valid, reason: '  Rapor  ' }).reason,
    'Rapor',
    'gerekçe kırpılır',
  )
  for (const invalid of [
    { ...valid, date: '2026-02-30' },
    { ...valid, date: '2026-10-06T09:00:00Z' },
    { ...valid, marks: { s1: 'gelmedi' } },
    { ...valid, reason: 'x'.repeat(501) },
  ]) {
    const result = attendanceInputSchema.safeParse(invalid)
    assert.equal(result.success, false)
    // Biçim ve takvim denetimi aynı değer için ikinci hata eklemez.
    assert.equal(result.error?.issues.length, 1, JSON.stringify(invalid))
  }
})

test('DOM-AKD-035 yönetici düzeltme gerekçesi şeması yetki kuralıyla aynı sınırı uygular', () => {
  const state = seed()
  const allowed = (reason: string) =>
    authorize(admin, 'attendance.record', { classId: 'c1', date: yesterday, reason }, state, {
      now,
    }).allowed
  assert.equal(ATTENDANCE_CORRECTION_REASON_MIN, 2)
  for (const reason of ['', ' ', ' a ', 'ab', '  Rapor  ', 'x'.repeat(500)]) {
    const parsed = attendanceCorrectionReasonSchema.safeParse(reason)
    assert.equal(parsed.success, allowed(reason), JSON.stringify(reason))
  }
  assert.equal(attendanceCorrectionReasonSchema.parse('  Rapor  '), 'Rapor', 'gerekçe kırpılır')
  const tooShort = attendanceCorrectionReasonSchema.safeParse(' a ')
  assert.equal(tooShort.error?.issues[0]?.message, 'Düzeltme için gerekçe yazın.')
  // Üst sınır gövde şemasındadır (API 400); form aynı mesajı istek atmadan verir.
  assert.equal(attendanceCorrectionReasonSchema.safeParse('x'.repeat(501)).success, false)
  assert.equal(
    attendanceInputSchema.safeParse({ date: '2026-10-05', marks: {}, reason: 'x'.repeat(501) })
      .success,
    false,
  )
})
