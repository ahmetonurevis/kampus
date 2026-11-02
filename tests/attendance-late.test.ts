import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  attendanceAlerts,
  attendanceSnapshots,
} from '../packages/school-core/src/lib/attendance-alerts.ts'
import {
  attendanceInputSchema,
  DEFAULT_LESSON_MINUTES,
  lateMinutesLimit,
  recordAttendance,
} from '../packages/school-core/src/lib/domain.ts'
import { dayKey } from '../packages/school-core/src/lib/format.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Geç gelme ve toplu işaretleme (OG-042, IST-093; DOM-AKD-036): "Geç geldi" devamsızlık günü
 * değildir, isteğe bağlı dakikası ders süresiyle sınırlıdır; sınıfın işaretleri tek işlemle yazılır,
 * aynı gün yinelenmez, değişiklik düzeltme geçmişine düşer.
 */

const now = '2026-10-06T10:00:00.000Z'
const day = '2026-10-06T09:00:00.000Z'

function seed(): State {
  const state = createSeed(new Date(now))
  // Sınıf c1 için günün programı sabitlenir: 40 ve 45 dakikalık iki ders + iptal edilmiş 90 dk.
  state.schedule = state.schedule.filter((lesson) => dayKey(lesson.date) !== dayKey(day))
  const base = state.schedule[0]
  assert.ok(base, 'örnek programda ders olmalı')
  const lesson = (id: string, duration: number, extra: object = {}) => ({
    ...base,
    id,
    classId: 'c1',
    date: '2026-10-06T06:00:00.000Z',
    duration,
    ...extra,
  })
  state.schedule.push(
    lesson('l-40', 40),
    lesson('l-45', 45),
    lesson('l-iptal', 90, { cancelledAt: now }),
  )
  return state
}
const students = (state: State) =>
  state.students.filter((s) => s.classId === 'c1' && s.isActive).map((s) => s.id)
const marks = (state: State, overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(students(state).map((id) => [id, 'present'])),
  ...overrides,
})
const entry = (state: State, studentId: string) =>
  state.attendance.find((a) => a.studentId === studentId && dayKey(a.date) === dayKey(day))

test('DOM-AKD-036: geç kalma dakikası günün en uzun iptal edilmemiş dersiyle sınırlıdır', () => {
  const state = seed()
  assert.equal(lateMinutesLimit(state, 'c1', day), 45)
  // Ders olmayan günde varsayılan ders süresi uygulanır.
  assert.equal(lateMinutesLimit(state, 'c1', '2026-10-04T09:00:00.000Z'), DEFAULT_LESSON_MINUTES)
  assert.equal(lateMinutesLimit(state, 'c-yok', day), DEFAULT_LESSON_MINUTES)
})

test('DOM-AKD-036: şema pozitif tamsayı dakikayı kabul eder, diğerlerini 400 sınıfında reddeder', () => {
  const body = (lateMinutes: unknown) => ({
    date: '2026-10-06',
    marks: { s1: 'late' },
    lateMinutes,
  })
  assert.ok(attendanceInputSchema.safeParse(body({ s1: 10 })).success)
  assert.ok(attendanceInputSchema.safeParse({ date: '2026-10-06', marks: { s1: 'late' } }).success)
  for (const bad of [0, -5, 1.5, '10', null])
    assert.equal(attendanceInputSchema.safeParse(body({ s1: bad })).success, false, String(bad))
})

test('DOM-AKD-036: geç gelen öğrencinin dakikası kayda yazılır; dakikasız geç gelme geçerlidir', () => {
  const state = seed()
  const [a, b] = students(state)
  assert.ok(a && b)
  recordAttendance(state, 'c1', day, marks(state, { [a]: 'late', [b]: 'late' }), now, {
    lateMinutes: { [a]: 12 },
  })
  assert.deepEqual([entry(state, a)?.status, entry(state, a)?.lateMinutes], ['late', 12])
  assert.deepEqual([entry(state, b)?.status, entry(state, b)?.lateMinutes], ['late', undefined])
  assert.equal(entry(state, b)?.corrections, undefined, 'ilk yoklama geçmiş taşımaz')
})

test('DOM-AKD-036: dakika geç gelmeyen öğrenciye ya da ders süresinin dışına girilemez, hiçbir kayıt değişmez', () => {
  for (const [lateMinutes, code] of [
    [{ present: 5 }, 'late_minutes_without_late'],
    [{ yabanci: 5 }, 'late_minutes_without_late'],
    [{ late: 46 }, 'late_minutes_out_of_range'],
    [{ late: 0 }, 'late_minutes_out_of_range'],
  ] as const) {
    const state = seed()
    const [late, present] = students(state)
    assert.ok(late && present)
    const input = Object.fromEntries(
      Object.entries(lateMinutes).map(([key, value]) => [
        key === 'late' ? late : key === 'present' ? present : key,
        value,
      ]),
    )
    const before = structuredClone(state.attendance)
    assert.throws(
      () =>
        recordAttendance(state, 'c1', day, marks(state, { [late]: 'late' }), now, {
          lateMinutes: input,
        }),
      isDomainError(code),
      code,
    )
    assert.deepEqual(state.attendance, before, code)
  }
})

test('DOM-AKD-036: sınırda 45 dakika geçerlidir', () => {
  const state = seed()
  const [late] = students(state)
  assert.ok(late)
  recordAttendance(state, 'c1', day, marks(state, { [late]: 'late' }), now, {
    lateMinutes: { [late]: 45 },
  })
  assert.equal(entry(state, late)?.lateMinutes, 45)
})

test('DOM-AKD-035, DOM-AKD-036: dakika değişikliği ve durum değişikliği düzeltme geçmişine düşer', () => {
  const state = seed()
  const [a] = students(state)
  assert.ok(a)
  const take = (status: string, lateMinutes?: Record<string, number>, reason = '') =>
    recordAttendance(state, 'c1', day, marks(state, { [a]: status }), now, {
      reason,
      by: 'u1',
      ...(lateMinutes ? { lateMinutes } : {}),
    })
  take('late', { [a]: 10 })
  take('late', { [a]: 10 })
  assert.equal(entry(state, a)?.corrections, undefined, 'aynı dakika geçmiş üretmez')
  take('late', { [a]: 20 }, 'Yanlış yazılmış')
  assert.deepEqual(
    entry(state, a)?.corrections?.map((c) => [
      c.previousStatus,
      c.status,
      c.previousLateMinutes,
      c.lateMinutes,
    ]),
    [['late', 'late', 10, 20]],
  )
  // Alan hiç verilmezse kayıtlı dakika korunur ve geçmiş eklenmez.
  take('late')
  assert.equal(entry(state, a)?.lateMinutes, 20)
  assert.equal(entry(state, a)?.corrections?.length, 1)
  // Alan verilip öğrencinin anahtarı yoksa dakika boşalır (geçmişe yazılır).
  take('late', {})
  assert.equal(entry(state, a)?.lateMinutes, undefined)
  assert.equal(entry(state, a)?.corrections?.length, 2)
  // Geç gelmeden çıkınca dakika tutulmaz; eski dakika geçmişte kalır.
  take('late', { [a]: 7 })
  take('present')
  assert.equal(entry(state, a)?.lateMinutes, undefined)
  const last = entry(state, a)?.corrections?.at(-1)
  assert.deepEqual(
    [last?.previousStatus, last?.status, last?.previousLateMinutes],
    ['late', 'present', 7],
  )
  assert.equal(
    state.attendance.filter((x) => x.studentId === a && dayKey(x.date) === dayKey(day)).length,
    1,
  )
})

test('IST-093: toplu işaretleme tek işlemle yazılır ve aynı gün için kayıt yinelenmez', () => {
  const state = seed()
  const ids = students(state)
  const count = state.attendance.length
  recordAttendance(state, 'c1', day, marks(state), now) // tümünü geldi
  assert.equal(state.attendance.length, count + ids.length)
  const [a, b] = ids
  assert.ok(a && b)
  recordAttendance(state, 'c1', day, marks(state, { [a]: 'absent', [b]: 'late' }), now, {
    lateMinutes: { [b]: 5 },
    by: 'u1',
  })
  assert.equal(state.attendance.length, count + ids.length, 'ikinci gönderim yeni satır eklemez')
  assert.deepEqual([entry(state, a)?.status, entry(state, b)?.status], ['absent', 'late'])
  assert.equal(entry(state, a)?.corrections?.length, 1)
  const untouched = ids[2]
  assert.ok(untouched)
  assert.equal(
    entry(state, untouched)?.corrections,
    undefined,
    'durumu değişmeyen öğrenciye geçmiş yazılmaz',
  )
})

test('DOM-AKD-036, DOM-ILT-052: geç gelme "gelmedi" bildirimi üretmez; dakika değişimi de üretmez', () => {
  const state = seed()
  const [a, b] = students(state)
  assert.ok(a && b)
  const take = (overrides: Record<string, string>, lateMinutes: Record<string, number> = {}) => {
    const before = attendanceSnapshots(state, day)
    recordAttendance(state, 'c1', day, marks(state, overrides), now, { lateMinutes })
    return attendanceAlerts(before, attendanceSnapshots(state, day), now)
  }
  assert.deepEqual(take({ [a]: 'late' }, { [a]: 10 }), [])
  assert.deepEqual(take({ [a]: 'late' }, { [a]: 25 }), [])
  // "Gelmedi"den "geç geldi"ye düzeltme, önceki bildirime ayrı düzeltme bildirimi bırakır.
  const absent = take({ [b]: 'absent' })
  assert.deepEqual(
    absent.map((x) => x.type),
    ['absence_recorded'],
  )
  assert.deepEqual(
    take({ [b]: 'late' }).map((x) => x.type),
    ['absence_corrected'],
  )
})

test('DOM-AKD-036: geçersiz dakika hatası alanı ve kodu taşır', () => {
  const state = seed()
  const [a] = students(state)
  assert.ok(a)
  try {
    recordAttendance(state, 'c1', day, marks(state, { [a]: 'late' }), now, {
      lateMinutes: { [a]: 99 },
    })
    assert.fail('hata bekleniyordu')
  } catch (error) {
    assert.ok(isDomainError('late_minutes_out_of_range')(error))
    assert.deepEqual((error as { path?: string[] }).path, ['lateMinutes', a])
    assert.match((error as Error).message, /1 ile 45 dakika/)
  }
})
