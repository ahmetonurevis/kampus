import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import {
  ATTENDANCE_CHANGED_MESSAGE,
  ATTENDANCE_MESSAGES,
} from '../packages/react-shared/src/use-academic-commands.ts'
import {
  ATTENDANCE_CHOICES,
  attendanceFailureText,
  attendanceMarks,
  attendancePayload,
  attendanceTargets,
  editsAfterFailure,
  markAll,
  markCounts,
  markStudent,
  teachingClassIds,
  todayLessons,
  unsavedCount,
} from '../apps/mobile/src/api/attendance.ts'

// Europe/Istanbul UTC+3: 06:00Z yerel 09:00; 22:30Z ertesi günün 01:30'udur.
const TODAY = '2026-11-03'

type LessonInput = Parameters<typeof attendanceTargets>[0]['lessons'] & object
type LessonRow = LessonInput[number]

const lesson = (id: string, overrides: Partial<LessonRow> = {}): LessonRow => ({
  id,
  classId: 'test-class-7a',
  subjectId: 'test-sub-mat',
  title: null,
  date: '2026-11-03T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  ...overrides,
})

const names = new Map([
  ['test-class-7a', '7-A'],
  ['test-class-7b', '7-B'],
  ['test-class-10a', '10-A'],
])
const subjects = new Map([['test-sub-mat', 'Matematik']])

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message, requestId: 'test-req' })

describe('IST-124 mobil öğretmen yoklaması: bugünün dersleri', () => {
  test('DOM-AKD-030 iptal ders ve başka günün dersi süzülür, kalanlar saate göre sıralanır', () => {
    const rows = todayLessons(
      [
        lesson('test-l-3', { date: '2026-11-03T09:00:00.000Z' }),
        lesson('test-l-cancel', { status: 'cancelled' }),
        lesson('test-l-1', { date: '2026-11-03T05:00:00.000Z' }),
        // 2 Kasım 22:30Z İstanbul'da 3 Kasım 01:30'dur, bugüne girer.
        lesson('test-l-0', { date: '2026-11-02T22:30:00.000Z' }),
        // 3 Kasım 21:30Z İstanbul'da 4 Kasım 00:30'dur, yarına aittir.
        lesson('test-l-late', { date: '2026-11-03T21:30:00.000Z' }),
        lesson('test-l-yesterday', { date: '2026-11-02T06:00:00.000Z' }),
        lesson('test-l-sub', { status: 'substituted', date: '2026-11-03T07:00:00.000Z' }),
      ],
      TODAY,
    )
    assert.deepEqual(
      rows.map((row) => row.id),
      ['test-l-0', 'test-l-1', 'test-l-sub', 'test-l-3'],
    )
  })

  test('DOM-YTK-022 ders satırı saat, ders ve dersliği gösterir; yedek derste yoklama açılmaz', () => {
    const targets = attendanceTargets({
      lessons: [
        lesson('test-l-1'),
        lesson('test-l-2', { classId: 'test-class-7b', title: 'Geometri', room: '' }),
      ],
      today: TODAY,
      classNames: names,
      subjectNames: subjects,
      teachingClassIds: new Set(['test-class-7a']),
      takenClassIds: new Set(['test-class-7a']),
    })
    assert.deepEqual(targets, [
      {
        key: 'test-l-1',
        classId: 'test-class-7a',
        title: '7-A',
        subtitle: '09:00–09:40 · Matematik · Derslik 101',
        canTake: true,
        taken: true,
      },
      {
        key: 'test-l-2',
        classId: 'test-class-7b',
        title: '7-B',
        subtitle: '09:00–09:40 · Geometri',
        canTake: false,
        taken: false,
      },
    ])
  })

  test('IST-124 ders programı kapalıyken ders verilen sınıflar ad sırasıyla listelenir', () => {
    const targets = attendanceTargets({
      lessons: null,
      today: TODAY,
      classNames: names,
      subjectNames: subjects,
      teachingClassIds: new Set(['test-class-10a', 'test-class-7b']),
      takenClassIds: new Set(['test-class-7b']),
    })
    assert.deepEqual(
      targets.map((row) => [row.title, row.canTake, row.taken]),
      [
        ['7-B', true, true],
        ['10-A', true, false],
      ],
    )
  })

  test('DOM-YTK-022 yalnız rehberi olduğu sınıf ders verilen sınıf sayılmaz', () => {
    const assignments = [
      { classId: 'test-class-7a', teacherId: 'test-t-selin' },
      { classId: 'test-class-7a', teacherId: 'test-t-selin' },
      { classId: 'test-class-7b', teacherId: 'test-t-other' },
    ]
    assert.deepEqual([...teachingClassIds(assignments, 'test-t-selin')], ['test-class-7a'])
    assert.equal(teachingClassIds(assignments, '').size, 0)
  })
})

describe('IST-124 mobil öğretmen yoklaması: durum değişimi', () => {
  const ids = ['test-s-deniz', 'test-s-ece', 'test-s-can']

  test('DOM-AKD-030 web ile aynı dört seçenek', () => {
    assert.deepEqual(
      ATTENDANCE_CHOICES.map((choice) => [choice.value, choice.label]),
      [
        ['present', 'Geldi'],
        ['absent', 'Gelmedi'],
        ['late', 'Geç geldi'],
        ['excused', 'Mazeretli'],
      ],
    )
  })

  test('DOM-AKD-035 kayıtlı durum yüklenir, yoksa "Geldi"; dokunulan işaret üstüne biner', () => {
    const saved = [
      { studentId: 'test-s-ece', status: 'absent' },
      { studentId: 'test-s-can', status: 'bilinmeyen' },
      { studentId: 'test-s-gone', status: 'late' },
    ]
    assert.deepEqual(attendanceMarks(ids, saved), {
      'test-s-deniz': 'present',
      'test-s-ece': 'absent',
      'test-s-can': 'present',
    })
    assert.deepEqual(attendanceMarks(ids, saved, { 'test-s-ece': 'excused' }), {
      'test-s-deniz': 'present',
      'test-s-ece': 'excused',
      'test-s-can': 'present',
    })
  })

  test('DOM-AKD-036 tek işaret ve "Tümünü geldi" girdiyi değiştirmez, yeni nesne döner', () => {
    const edits = Object.freeze({ 'test-s-ece': 'absent' as const })
    assert.deepEqual(markStudent(edits, 'test-s-deniz', 'late'), {
      'test-s-ece': 'absent',
      'test-s-deniz': 'late',
    })
    assert.deepEqual(markAll(edits, ids, 'present'), {
      'test-s-deniz': 'present',
      'test-s-ece': 'present',
      'test-s-can': 'present',
    })
    assert.deepEqual(edits, { 'test-s-ece': 'absent' })
  })

  test('IST-124 sayım ve kaydedilmemiş değişiklik kayıtlı hâle göre hesaplanır', () => {
    const base = attendanceMarks(ids, [{ studentId: 'test-s-ece', status: 'absent' }])
    const marks = attendanceMarks(ids, [{ studentId: 'test-s-ece', status: 'absent' }], {
      'test-s-ece': 'absent',
      'test-s-can': 'late',
    })
    assert.deepEqual(markCounts(marks), { present: 1, absent: 1, late: 1, excused: 0 })
    assert.equal(unsavedCount(base, marks), 1)
    assert.equal(unsavedCount(base, base), 0)
  })
})

describe('IST-124 mobil öğretmen yoklaması: kaydetme', () => {
  test('DOM-AKD-035 yük bugünü, bütün işaretleri ve sınıf sürümünü taşır; dakika gönderilmez', () => {
    const marks = { 'test-s-deniz': 'present', 'test-s-ece': 'late' } as const
    const payload = attendancePayload({
      classId: 'test-class-7a',
      today: TODAY,
      marks,
      classVersion: 4,
    })
    assert.deepEqual(payload, {
      classId: 'test-class-7a',
      date: TODAY,
      marks: { 'test-s-deniz': 'present', 'test-s-ece': 'late' },
      classVersion: 4,
    })
    // `lateMinutes` yoksa sunucu kayıtlı dakikaları korur (DOM-AKD-036).
    assert.equal('lateMinutes' in payload, false)
    assert.notEqual(payload.marks, marks)
    assert.equal(
      attendancePayload({ classId: 'c', today: TODAY, marks, classVersion: undefined })
        .classVersion,
      null,
    )
  })

  test('DOM-AKD-035 sürüm çakışmasında işaretler bırakılır, ekran sunucunun son hâlini gösterir', () => {
    const edits = { 'test-s-ece': 'absent' } as const
    assert.deepEqual(editsAfterFailure(edits, apiError(409, 'version_conflict')), {})
    // Ağ ve kural hatasında kayıt değişmemiştir; kaydedilmemiş işaretler yeniden denemek için kalır.
    assert.deepEqual(editsAfterFailure(edits, apiError(0, 'network_error')), edits)
    assert.deepEqual(editsAfterFailure(edits, apiError(403, 'attendance_class_forbidden')), edits)
    assert.deepEqual(editsAfterFailure(edits, apiError(409, 'idempotency_in_progress')), edits)
  })

  test('IST-124 hata metni web ile aynı Türkçe eşlemeden gelir', () => {
    assert.equal(
      attendanceFailureText(apiError(409, 'version_conflict')),
      ATTENDANCE_CHANGED_MESSAGE,
    )
    assert.equal(
      attendanceFailureText(apiError(403, 'attendance_correction_admin_only')),
      ATTENDANCE_MESSAGES.attendance_correction_admin_only,
    )
    assert.equal(
      attendanceFailureText(apiError(500, 'internal', 'Bir sorun oluştu.')),
      'Bir sorun oluştu.',
    )
    assert.equal(attendanceFailureText(apiError(401, 'unauthorized')), null)
  })
})
