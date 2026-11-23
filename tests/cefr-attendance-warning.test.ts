import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import {
  ATTENDANCE_WARNING_PERCENT,
  attendanceWarning,
  attendanceWarningOf,
} from '../packages/school-core/src/cefr/attendance-warning.ts'
import type { LessonHourAttendance } from '../packages/school-core/src/cefr/progression.ts'

const rows = (absent: number, present = 0, excused = false): LessonHourAttendance[] => [
  ...Array.from({ length: absent }, (_, i) => ({
    lessonHourId: `a${String(i)}`,
    status: 'absent' as const,
    excused,
  })),
  ...Array.from({ length: present }, (_, i) => ({
    lessonHourId: `p${String(i)}`,
    status: 'present' as const,
  })),
]

describe('devam şartı izleme uyarısı (DOM-DIL-060)', () => {
  test('eşik hakkın yüzde 80i: 40 saatte hak 8, uyarı 7. devamsızlıkta (6,4 -> 7)', () => {
    assert.equal(ATTENDANCE_WARNING_PERCENT, 80)
    const at = (absent: number) => attendanceWarningOf({ totalHours: 40, rows: rows(absent) })
    assert.equal(at(0).level, 'ok')
    assert.equal(at(6).level, 'ok')
    assert.equal(at(7).level, 'warning')
    assert.equal(at(8).level, 'warning')
    assert.equal(at(8).allowanceHours, 8)
    assert.equal(at(9).level, 'exceeded')
  })

  test('sınır tam eşitlikte: hak 10 iken 8 saat uyarıdır, 7 değil', () => {
    const w = (absentHours: number) =>
      attendanceWarning({ totalHours: 50, requiredHours: 40, absentHours }).level
    assert.equal(w(7), 'ok')
    assert.equal(w(8), 'warning')
    assert.equal(w(10), 'warning')
    assert.equal(w(11), 'exceeded')
  })

  test('kurum oranı 900: 40 saatte hak 4, uyarı 4. saatte (3,2 -> 4) ve 5te aşıldı', () => {
    const at = (absent: number) =>
      attendanceWarningOf({ totalHours: 40, rows: rows(absent), minAttendancePermille: 900 })
    assert.equal(at(3).level, 'ok')
    assert.equal(at(4).level, 'warning')
    assert.equal(at(4).allowanceHours, 4)
    assert.equal(at(5).level, 'exceeded')
  })

  test('sıfır hak: devamsızlık yoksa ok, ilk devamsızlık aşıldı', () => {
    const at = (absent: number) =>
      attendanceWarningOf({ totalHours: 20, rows: rows(absent), minAttendancePermille: 1000 })
    assert.deepEqual(at(0), { level: 'ok', allowanceHours: 0, absentHours: 0 })
    assert.equal(at(1).level, 'exceeded')
  })

  test('yoklaması alınmamış saat devamsızlık sayılmaz; özürlü gelmedi sayılır', () => {
    assert.equal(attendanceWarningOf({ totalHours: 40, rows: rows(0, 5) }).level, 'ok')
    assert.equal(attendanceWarningOf({ totalHours: 40, rows: rows(7, 0, true) }).level, 'warning')
  })
})
